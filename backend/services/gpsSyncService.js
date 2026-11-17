const axios = require('axios');
const Vehicle = require('../models/Vehicle');
const Plant = require('../models/Plant');
const GpsSetting = require('../models/GpsSetting');
const VehicleLocation = require('../models/VehicleLocation');
const GpsHistory = require('../models/GpsHistory');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const PlantEntry = require('../models/PlantEntry');
const GpsSyncLock = require('../models/GpsSyncLock');
const GpsSyncLog = require('../models/GpsSyncLog');
const CronExecutionLog = require('../models/CronExecutionLog');
const ZoneSession = require('../models/ZoneSession');
const {
  calculateHaversineDistance,
  getVehiclePlantStatus,
  calculateStayDuration,
  isValidFreshGpsTimestamp,
} = require('./geofenceService');
const { getReadableLocation } = require('./locationHelper');
const { isSafeExternalUrl } = require('../utils/security');
const { executeAutomatedDriverAssignment } = require('./driverMatchingService');
const {
  parseTelemetryNumber,
  parseTelemetryBoolean,
  normalizeVendorMovementStatus,
} = require('./telemetryValues');
const { maskUrlSecret } = require('../utils/security');
const { normalizeVehicleNumber } = require('./gpsTimelineService');
const { rebuildPlantStays } = require('./gpsDataService');
const { rebuildDailyGpsReports } = require('./reportCalculationService');
const { istDateString } = require('./gpsTimelineService');
const { getZoneId, reconcileZoneSession } = require('./zoneSessionService');
const { decryptGpsCredential } = require('../utils/gpsCredentialCrypto');
const { getAssignedGpsProvider, getGpsConnectionStatus } = require('../utils/gpsProvider');

const DEFAULT_WHEELSEYE_URL = (process.env.WHEELSEYE_API_URL || '').trim();
const DEFAULT_FLEETX_URL = (process.env.FLEETX_API_URL || '').trim();
const WHEELSEYE_PROVIDER = 'WheelsEye GPS';
const FLEETX_PROVIDER = 'FleetX';
let fleetxLoginPromise = null;

function buildProviderSettingQuery(provider = WHEELSEYE_PROVIDER) {
  const normalized = String(provider || '').toLowerCase();
  if (normalized.includes('fleet')) {
    return {
      archived: { $ne: true },
      $or: [
        { provider: /fleetx|fleet/i },
        { apiUrl: /fleetx|fleet/i },
      ],
    };
  }
  return {
    archived: { $ne: true },
    $or: [
      { provider: /wheels.?eye/i },
      { apiUrl: /wheelseye/i },
    ],
  };
}

async function findOpenProviderZoneSession(vehicleNumber, provider) {
  return ZoneSession.findOne({
    vehicleNumberNormalized: normalizeVehicleNumber(vehicleNumber),
    provider,
    exitedAt: null,
    archived: { $ne: true },
  }).sort({ enteredAt: -1 });
}

const LOCK_ID = 'gps_sync_lock';
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const activeLockOwners = new Map();
const rawSampleLogged = new Set();

function getWheelsEyeUrlToken(apiUrl) {
  try {
    const url = new URL(apiUrl);
    for (const key of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token', 'key', 'secret']) {
      const value = url.searchParams.get(key);
      if (value) return value.trim();
    }
  } catch (_) {}
  return '';
}

function redactSensitiveFields(value) {
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (typeof value === 'string') {
    return value
      .replace(/((?:access[_-]?token|api[_-]?key|token|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
      .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]');
  }
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => {
      if (/token|secret|password|authorization|api.?key/i.test(key)) {
        return [key, '[REDACTED]'];
      }
      return [key, redactSensitiveFields(fieldValue)];
    })
  );
}

function logRawTelemetrySample(provider, items) {
  if (process.env.GPS_RAW_SAMPLE_LOGGING !== 'true' || rawSampleLogged.has(provider)) return;
  rawSampleLogged.add(provider);
  console.info(`[GPS raw sample] ${provider}: ${JSON.stringify(redactSensitiveFields(items.slice(0, 3)))}`);
}

/**
 * Calculates the exact next fixed 30-minute block boundary in Indian Standard Time (Asia/Kolkata).
 * Fixed slots: HH:00:00 IST and HH:30:00 IST.
 */
function getNextFixed30MinSlotIST(refDate = new Date()) {
  const istFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = istFormatter.formatToParts(refDate);
  const partMap = {};
  for (const p of parts) partMap[p.type] = p.value;

  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10) - 1;
  const day = parseInt(partMap.day, 10);
  let hour = parseInt(partMap.hour, 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(partMap.minute, 10);

  // Compute next target slot in IST
  let targetMinute = 0;
  let targetHour = hour;
  let targetDay = day;

  if (minute < 30) {
    targetMinute = 30;
  } else {
    targetMinute = 0;
    targetHour = hour + 1;
    if (targetHour >= 24) {
      targetHour = 0;
      targetDay += 1;
    }
  }

  // Construct target Date object matching the IST slot
  // IST is UTC+5:30 -> UTC milliseconds = IST milliseconds - 5.5 hours
  const istTargetMs = Date.UTC(year, month, targetDay, targetHour, targetMinute, 0, 0);
  const utcEquivalentMs = istTargetMs - (5.5 * 60 * 60 * 1000);
  let target = new Date(utcEquivalentMs);

  // Safety guard: ensure target is strictly in the future
  if (target.getTime() <= refDate.getTime()) {
    target = new Date(target.getTime() + 30 * 60 * 1000);
  }

  return target;
}

/**
 * Parses GPS telemetry timestamps supporting epoch seconds, milliseconds, ISO strings,
 * or provider-specific time fields from WheelsEye.
 */
function parseTelematicsTimestamp(item) {
  const candidates = [
    item.gpsTimestamp,
    item.gpsTime,
    item.lastGpsTimestamp,
    item.dttimeInEpoch,
    item.dttime,
    item.lastUpdatedAt,
    item.lastStatusTime,
    item.createdDateReadable,
    item.timestamp,
  ];

  for (const value of candidates) {
    if (value === undefined || value === null || value === '') continue;
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      if (numericValue <= 0) continue;
      const date = new Date(numericValue > 1e11 ? numericValue : numericValue * 1000);
      if (!isNaN(date.getTime())) return date;
      continue;
    }
    const timestamp = String(value).trim();
    if (!/(?:z|[+-]\d{2}:?\d{2})$/i.test(timestamp)) continue;
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) return date;
  }
  return null;
}

const parseWheelseyeTimestamp = parseTelematicsTimestamp;

/**
 * Acquires distributed database lock.
 * Returns true if lock was acquired, false if already locked by another worker.
 */
function getProviderLockId(provider = WHEELSEYE_PROVIDER) {
  return `${LOCK_ID}_${provider.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

async function acquireDistributedLock(callerName = 'Worker', provider = WHEELSEYE_PROVIDER) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TIMEOUT_MS);
  const lockId = getProviderLockId(provider);
  const lockOwner = `${callerName}_${now.getTime()}_${Math.random().toString(36).slice(2, 10)}`;

  try {
    const doc = await GpsSyncLock.findOneAndUpdate(
      {
        _id: lockId,
        $or: [
          { isLocked: false },
          { expiresAt: { $lt: now } },
          { isLocked: { $exists: false } },
        ],
      },
      {
        $set: {
          isLocked: true,
          lockedAt: now,
          lockedBy: lockOwner,
          expiresAt,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    if (!doc) return false;
    activeLockOwners.set(lockId, lockOwner);
    return true;
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }
}

/**
 * Releases distributed database lock.
 */
async function releaseDistributedLock(provider = WHEELSEYE_PROVIDER) {
  const lockId = getProviderLockId(provider);
  const lockOwner = activeLockOwners.get(lockId);
  if (!lockOwner) return;
  try {
    await GpsSyncLock.updateOne(
      { _id: lockId, lockedBy: lockOwner },
      {
        $set: {
          isLocked: false,
          expiresAt: new Date(0),
        },
      }
    );
    activeLockOwners.delete(lockId);
  } catch (err) {
    console.warn('[Distributed Lock Release Warning]:', err.message);
  }
}

/**
 * Calls Wheelseye GPS Telemetry endpoint with 3 retry attempts (Requirement 4).
 */
async function fetchWheelseyeTelemetryWithRetries(apiUrl, maxAttempts = 3, apiKey = '') {
  apiUrl = typeof apiUrl === 'string' ? apiUrl.trim() : '';
  apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!apiUrl || !isSafeExternalUrl(apiUrl)) {
    throw new Error('Refusing to query unsafe or invalid GPS API URL.');
  }
  const requestUrl = new URL(apiUrl);
  if (apiKey) {
    requestUrl.searchParams.set('accessToken', apiKey);
  }
  const safeRequestUrl = maskUrlSecret(requestUrl.toString());

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const delay = attempt === 1 ? 0 : 1000 * (2 ** (attempt - 2));
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      console.log(`[Wheelseye API] Attempt ${attempt}/${maxAttempts} requesting ${safeRequestUrl}...`);
      const response = await axios.get(requestUrl.toString(), {
        timeout: 15000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SikkaFleet-GpsSync/2.0',
        },
      });

      if (response.data && response.data.data && Array.isArray(response.data.data.list)) {
        logRawTelemetrySample('WheelsEye', response.data.data.list);
        return { list: response.data.data.list, status: `${response.status} OK` };
      }
      if (response.data && Array.isArray(response.data.list)) {
        logRawTelemetrySample('WheelsEye', response.data.list);
        return { list: response.data.list, status: `${response.status} OK` };
      }
      if (Array.isArray(response.data)) {
        logRawTelemetrySample('WheelsEye', response.data);
        return { list: response.data, status: `${response.status} OK` };
      }

      throw new Error(`Unexpected payload structure from Wheelseye API (status: ${response.status})`);
    } catch (err) {
      lastErr = err;
      console.warn(`[Wheelseye API Attempt ${attempt} Failed]: ${getSafeWheelsEyeError(err)}`);
      const status = err.response?.status;
      if (status === 401 || status === 403 || (status && status < 500 && status !== 429)) break;
    }
  }

  throw lastErr;
}

/**
 * Normalizes WheelsEye vehicle telemetry item into unified format.
 */
function normalizeWheelseyeItem(item) {
  const lat = parseTelemetryNumber(item.latitude);
  const lon = parseTelemetryNumber(item.longitude);
  const speed = parseTelemetryNumber(item.speed);
  const isIgnitionOn = parseTelemetryBoolean(item.ignition);
  const movementStatus = normalizeVendorMovementStatus(
    item.movementStatus || item.movement_status || item.motionStatus || item.status || item.currentStatus
  );

  return {
    vehicleNumber: normalizeVehicleNumber(item.vehicleNumber),
    driverName: item.driverName || '',
    latitude: lat,
    longitude: lon,
    speed,
    ignition: isIgnitionOn,
    movementStatus,
    deviceNumber: item.deviceNumber || '',
    vendorName: item.venndorName || item.vendorName || null,
    vehicleType: item.vehicleType || null,
    angle: parseTelemetryNumber(item.angle),
    chargeOn: parseTelemetryBoolean(item.chargeOn),
    timestamp: parseTelematicsTimestamp(item),
    providerTransitionTimestamp: item.transitionTimestamp
      ? parseTelematicsTimestamp({ gpsTimestamp: item.transitionTimestamp })
      : null,
    address: '',
    provider: 'WheelsEye GPS',
    rawTelemetry: {
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      speed: item.speed ?? null,
      ignition: item.ignition ?? null,
      status: item.status ?? null,
      movementStatus: item.movementStatus ?? item.movement_status ?? item.motionStatus ?? null,
      timestamp: item.gpsTimestamp ?? item.gpsTime ?? item.lastGpsTimestamp ??
        item.dttimeInEpoch ?? item.dttime ?? item.lastUpdatedAt ?? item.lastStatusTime ??
        item.createdDateReadable ?? item.timestamp ?? null,
      transitionTimestamp: item.transitionTimestamp ?? null,
    },
    rawEventId: String(item.dttimeInEpoch || item.createdDate || ''),
  };
}

function selectLatestTelemetryByVehicle(items) {
  const latestByVehicleNumber = new Map();
  for (const item of items) {
    const key = normalizeVehicleNumber(item.vehicleNumber);
    if (!key || !item.timestamp) continue;
    const current = latestByVehicleNumber.get(key);
    if (!current || item.timestamp > current.timestamp) {
      latestByVehicleNumber.set(key, item);
    }
  }
  return [...latestByVehicleNumber.values()];
}

function filterTelemetryForActiveVehicles(items, vehiclesByNumber, provider) {
  const expectedProvider = provider ? getGpsProvider(provider) : null;
  return items.filter((item) => {
    const vehicle = vehiclesByNumber.get(normalizeVehicleNumber(item.vehicleNumber));
    return vehicle?.status === 'Active' &&
      (!expectedProvider || getAssignedGpsProvider(vehicle) ===
        (expectedProvider === WHEELSEYE_PROVIDER ? 'wheelseye' : 'fleetx'));
  });
}

/**
 * Fetches the single WheelsEye telemetry source.
 */
async function fetchWheelsEyeTelemetry(gpsSettings = []) {
  const wheelEyeConfigs = gpsSettings
    .filter((setting) => setting.provider && (
      setting.provider.toLowerCase().includes('wheels') ||
      (setting.apiUrl && setting.apiUrl.includes('wheelseye'))
    ))
    .sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0));
  const weConfig = wheelEyeConfigs.find((setting) => setting.status === 'Active') || wheelEyeConfigs[0];
  const envUrl = (process.env.WHEELSEYE_API_URL || '').trim();
  let weUrl = envUrl || weConfig?.apiUrl || DEFAULT_WHEELSEYE_URL;
  if (!weUrl || weUrl.includes('••••')) {
    weUrl = DEFAULT_WHEELSEYE_URL;
  }
  const weActive = Boolean(envUrl) || !weConfig || weConfig.status === 'Active';
  const weEnvToken = (process.env.WHEELSEYE_API_KEY || process.env.WHEELSEYE_ACCESS_TOKEN || '').trim();
  const weEnvUrlToken = getWheelsEyeUrlToken(process.env.WHEELSEYE_API_URL || '');
  const weSavedUrlToken = getWheelsEyeUrlToken(weConfig?.apiUrl || '');
  const weToken = weEnvToken || weEnvUrlToken ||
    decryptGpsCredential(weConfig?.encryptedApiKey || '').trim() || weSavedUrlToken;
  const weUrlHasCredential = Boolean(weEnvUrlToken || weSavedUrlToken);
  const weCredentialSource = weEnvToken
    ? 'WHEELSEYE_API_KEY or WHEELSEYE_ACCESS_TOKEN'
    : weEnvUrlToken
      ? 'WHEELSEYE_API_URL query'
      : weToken && (weConfig?.encryptedApiKey || '')
      ? 'GPS settings'
      : weUrlHasCredential
        ? (process.env.WHEELSEYE_API_URL?.trim() ? 'WHEELSEYE_API_URL query' : 'GPS settings URL query')
      : 'none';

  if (!weActive || !weUrl) {
    throw new Error('WheelsEye GPS API URL is not configured or is inactive.');
  }

  const credentialSource = weCredentialSource;
  let response;
  try {
    response = await fetchWheelseyeTelemetryWithRetries(weUrl, 3, weToken);
  } catch (err) {
    const statusCode = err.response?.status;
    const error = new Error(statusCode ? `WheelsEye request failed with HTTP ${statusCode}.` : `WheelsEye request failed: ${getSafeWheelsEyeError(err)}.`);
    error.wheelsEyeStatus = {
      status: statusCode ? `HTTP ${statusCode}` : getSafeWheelsEyeError(err),
      error: error.message,
      count: 0,
      authFailed: statusCode === 401 || statusCode === 403,
      apiUrl: maskUrlSecret(weUrl),
      credentialSource,
    };
    throw error;
  }

  const items = response.list.map(normalizeWheelseyeItem);
  const validItems = items.filter((item) => item.vehicleNumber && item.timestamp &&
    Number.isFinite(item.latitude) && Number.isFinite(item.longitude) &&
    item.latitude >= -90 && item.latitude <= 90 &&
    item.longitude >= -180 && item.longitude <= 180 &&
    !(item.latitude === 0 && item.longitude === 0));
  const latestVehicles = selectLatestTelemetryByVehicle(validItems);
  const wheelsEyeStatus = {
    status: response.status,
    error: null,
    count: latestVehicles.length,
    authFailed: false,
    apiUrl: maskUrlSecret(weUrl),
    credentialSource,
  };

  return {
    vehicles: latestVehicles,
    samples: validItems,
    providerVehicles: items.filter((item) => item.vehicleNumber),
    wheelsEyeStatus,
    providerStatus: wheelsEyeStatus,
    totalRawCount: items.length,
  };
}

async function fetchFleetxTelemetryWithRetries(apiUrl, maxAttempts = 3, accessToken = '', basicAuth = '') {
  const normalizedUrl = typeof apiUrl === 'string' ? apiUrl.trim() : '';
  if (!normalizedUrl || !isSafeExternalUrl(normalizedUrl)) {
    throw new Error('Refusing to query unsafe or invalid FleetX API URL.');
  }
  const requestUrl = new URL(normalizedUrl);
  const fallbackToken = accessToken.trim();
  let currentToken = '';
  const loginUrl = (process.env.FLEETX_LOGIN_URL || '').trim();
  const loginUsername = (process.env.FLEETX_USERNAME || '').trim();
  const loginPassword = (process.env.FLEETX_PASSWORD || '').trim();
  const loginBasicAuth = (process.env.FLEETX_BASIC_AUTH || basicAuth || '').trim();
  const canRefreshToken = Boolean(loginUrl && loginUsername && loginPassword);

  async function getAuthToken() {
    if (currentToken) return currentToken;
    if (!canRefreshToken) return fallbackToken;
    if (fleetxLoginPromise) {
      currentToken = await fleetxLoginPromise;
      return currentToken;
    }
    if (!isSafeExternalUrl(loginUrl)) {
      throw new Error('FleetX login URL must be a secure public HTTP/HTTPS endpoint.');
    }
    fleetxLoginPromise = (async () => {
      const formData = new FormData();
      formData.append('username', loginUsername);
      formData.append('password', loginPassword);
      formData.append('grant_type', 'password');
      let loginResponse;
      try {
        loginResponse = await axios.post(loginUrl, formData, {
          timeout: 15000,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'SikkaFleet-GpsSync/2.0',
            ...(loginBasicAuth ? { Authorization: loginBasicAuth } : {}),
          },
        });
      } catch (error) {
        error.fleetxLoginError = true;
        throw error;
      }
      const token = loginResponse?.data?.access_token ||
        loginResponse?.data?.accessToken ||
        loginResponse?.data?.token ||
        loginResponse?.data?.data?.access_token ||
        loginResponse?.data?.data?.accessToken ||
        loginResponse?.data?.data?.token ||
        '';
      if (!token) {
        const error = new Error('FleetX login response did not contain an access token.');
        error.code = 'FLEETX_LOGIN_TOKEN_MISSING';
        throw error;
      }
      return token;
    })().finally(() => {
      fleetxLoginPromise = null;
    });
    currentToken = await fleetxLoginPromise;
    return currentToken;
  }

  let lastErr = null;
  let unauthorizedRetried = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const delay = attempt === 1 ? 0 : 1000 * (2 ** (attempt - 2));
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const tokenForRequest = await getAuthToken();
      const authHeader = tokenForRequest ? { Authorization: `Bearer ${tokenForRequest}` } : basicAuth ? { Authorization: basicAuth } : {};
      console.log(`[FleetX API] Attempt ${attempt}/${maxAttempts} requesting ${maskUrlSecret(requestUrl.toString())}...`);
      const response = await axios.get(requestUrl.toString(), {
        timeout: 15000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SikkaFleet-GpsSync/2.0',
          ...authHeader,
        },
      });
      const payload = response?.data;
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.data?.vehicles)
            ? payload.data.vehicles
          : Array.isArray(payload?.result)
            ? payload.result
            : Array.isArray(payload?.vehicles)
              ? payload.vehicles
            : Array.isArray(payload?.items)
              ? payload.items
              : Array.isArray(payload?.list)
                ? payload.list
                : payload?.data && typeof payload.data === 'object'
                  ? [payload.data]
                  : payload && typeof payload === 'object'
                    ? [payload]
                    : null;
      if (Array.isArray(list)) {
        return { list, status: `${response.status} OK` };
      }
      throw new Error(`Unexpected payload structure from FleetX API (status: ${response.status})`);
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const errorDescription = status
        ? `HTTP ${status}`
        : err.code === 'ECONNABORTED'
          ? 'Request timed out'
          : err.code === 'FLEETX_LOGIN_TOKEN_MISSING'
            ? err.message
          : 'FleetX request failed';
      console.warn(`[FleetX API Attempt ${attempt} Failed]: ${errorDescription}`);
      if (status === 401 || status === 403) {
        currentToken = '';
      }
      if (status === 401 && canRefreshToken && !unauthorizedRetried) {
        unauthorizedRetried = true;
        continue;
      }
      if (err.code === 'FLEETX_LOGIN_TOKEN_MISSING' || err.fleetxLoginError ||
          status === 403 || status === 401 ||
          (status && status < 500 && status !== 401 && status !== 429)) break;
    }
  }
  throw lastErr;
}

function getFleetxVehicleUrl(vehicleNumber) {
  const configuredUrl = (process.env.FLEETX_VEHICLE_URL || '').trim();
  if (!configuredUrl || !isSafeExternalUrl(configuredUrl)) {
    throw new Error('FleetX vehicle API URL is not configured or is invalid.');
  }
  const encodedVehicleNumber = encodeURIComponent(String(vehicleNumber || '').trim());
  if (!encodedVehicleNumber) {
    throw new Error('A vehicle number is required for a FleetX vehicle lookup.');
  }
  if (configuredUrl.includes('{vehicleNumber}')) {
    return configuredUrl.replace('{vehicleNumber}', encodedVehicleNumber);
  }
  return `${configuredUrl.replace(/\/+$/, '')}/${encodedVehicleNumber}`;
}

function getFleetxCredentials(gpsSettings = []) {
  const config = gpsSettings.find((setting) => setting.provider && setting.provider.toLowerCase().includes('fleet'));
  const token = (process.env.FLEETX_BEARER_TOKEN || process.env.FLEETX_API_KEY || '').trim() ||
    decryptGpsCredential(config?.encryptedApiKey || '').trim();
  return {
    token,
    basicAuth: (process.env.FLEETX_BASIC_AUTH || '').trim(),
  };
}

async function fetchFleetxVehicleTelemetry(vehicleNumber, gpsSettings = []) {
  const config = gpsSettings.find((setting) => setting.provider && setting.provider.toLowerCase().includes('fleet'));
  if (config && config.status !== 'Active') {
    throw new Error('FleetX GPS API is inactive.');
  }
  const { token, basicAuth } = getFleetxCredentials(gpsSettings);
  const response = await fetchFleetxTelemetryWithRetries(getFleetxVehicleUrl(vehicleNumber), 3, token, basicAuth);
  return response.list.map(normalizeFleetxItem);
}

function normalizeFleetxItem(item) {
  const latitude = parseTelemetryNumber(
    item.latitude ?? item.lat ?? item.Latitude ?? item.location?.lat ?? item.location?.latitude
  );
  const longitude = parseTelemetryNumber(
    item.longitude ?? item.lng ?? item.Lng ?? item.location?.lng ?? item.location?.longitude
  );
  const speed = parseTelemetryNumber(item.speed ?? item.speedKmh ?? item.velocity ?? item.velocityKmh ?? item.speedKmH);
  const ignition = parseTelemetryBoolean(item.ignition ?? item.engineOn ?? item.engineStatus ?? item.isIgnitionOn);
  const rawTimestamp = item.lastUpdated ?? item.lastUpdate ?? item.timestamp ?? item.gpsTime ?? item.updatedAt ?? item.epoch ?? item.time;
  const vehicleNumber = normalizeVehicleNumber(
    item.vehicleNumber || item.vehicleNo || item.vehicle_no || item.registrationNumber || item.number || item.vin || item.vehicleId
  );

  return {
    vehicleNumber,
    driverName: item.driverName || item.driver || '',
    latitude,
    longitude,
    speed,
    ignition,
    movementStatus: normalizeVendorMovementStatus(item.movementStatus || item.movement_status || item.status || item.currentStatus),
    deviceNumber: item.deviceNumber || item.deviceId || '',
    vendorName: 'FleetX',
    vehicleType: item.vehicleType || null,
    angle: parseTelemetryNumber(item.angle ?? item.heading),
    chargeOn: parseTelemetryBoolean(item.chargeOn ?? item.batteryOn),
    timestamp: parseTelematicsTimestamp({ gpsTimestamp: rawTimestamp, timestamp: rawTimestamp }),
    providerTransitionTimestamp: null,
    address: item.address || '',
    provider: FLEETX_PROVIDER,
    rawTelemetry: {
      latitude: item.latitude ?? item.lat ?? null,
      longitude: item.longitude ?? item.lng ?? null,
      speed: item.speed ?? item.speedKmh ?? null,
      ignition: item.ignition ?? item.engineOn ?? null,
      status: item.status ?? null,
      movementStatus: item.movementStatus ?? item.movement_status ?? null,
      timestamp: rawTimestamp ?? null,
    },
    rawEventId: String(item.id || item.vehicleNumber || item.timestamp || Date.now()),
  };
}

async function fetchFleetxTelemetry(gpsSettings = []) {
  const fxConfig = gpsSettings.find((s) => s.provider && s.provider.toLowerCase().includes('fleet'));
  let fxUrl = (process.env.FLEETX_API_URL || '').trim() || fxConfig?.apiUrl || DEFAULT_FLEETX_URL;
  if (!fxUrl || fxUrl.includes('••••')) {
    fxUrl = DEFAULT_FLEETX_URL;
  }
  const fxActive = fxConfig ? fxConfig.status === 'Active' : true;
  const { token: fxToken, basicAuth: fxBasicAuth } = getFleetxCredentials(gpsSettings);

  if (!fxActive || !fxUrl) {
    throw new Error('FleetX GPS API URL is not configured or is inactive.');
  }

  let response;
  try {
    response = await fetchFleetxTelemetryWithRetries(fxUrl, 3, fxToken, fxBasicAuth);
  } catch (err) {
    const statusCode = err.response?.status;
    const reason = statusCode
      ? `HTTP ${statusCode}`
      : err.code === 'ECONNABORTED'
        ? 'Request timed out'
        : err.code === 'FLEETX_LOGIN_TOKEN_MISSING'
          ? err.message
          : 'REQUEST_FAILED';
    const error = new Error(`FleetX request failed: ${reason}.`);
    error.fleetXStatus = {
      status: statusCode ? `HTTP ${statusCode}` : err.code || 'REQUEST_FAILED',
      error: error.message,
      count: 0,
      authFailed: statusCode === 401 || statusCode === 403,
      apiUrl: maskUrlSecret(fxUrl),
      credentialSource: fxToken ? 'FLEETX_BEARER_TOKEN or FLEETX_API_KEY' : fxBasicAuth ? 'FLEETX_BASIC_AUTH' : 'none',
    };
    throw error;
  }

  const list = Array.isArray(response.list) ? response.list : [];
  const items = list.map(normalizeFleetxItem);
  const validItems = items.filter((item) => item.vehicleNumber && item.timestamp &&
    Number.isFinite(item.latitude) && Number.isFinite(item.longitude) &&
    item.latitude >= -90 && item.latitude <= 90 &&
    item.longitude >= -180 && item.longitude <= 180 &&
    !(item.latitude === 0 && item.longitude === 0));
  const latestVehicles = selectLatestTelemetryByVehicle(validItems);
  const fleetXStatus = {
    status: response.status,
    error: null,
    count: latestVehicles.length,
    authFailed: false,
    apiUrl: maskUrlSecret(fxUrl),
    credentialSource: fxToken ? 'FLEETX_BEARER_TOKEN or FLEETX_API_KEY' : fxBasicAuth ? 'FLEETX_BASIC_AUTH' : 'none',
  };

  return {
    vehicles: latestVehicles,
    samples: validItems,
    providerVehicles: items.filter((item) => item.vehicleNumber),
    fleetXStatus,
    providerStatus: fleetXStatus,
    totalRawCount: items.length,
  };
}

function getGpsProvider(provider = WHEELSEYE_PROVIDER) {
  const normalized = String(provider).toLowerCase().replace(/[^a-z]/g, '');
  if (!normalized) return WHEELSEYE_PROVIDER;
  if (normalized === 'both') return 'both';
  if (normalized.includes('wheels')) return WHEELSEYE_PROVIDER;
  if (normalized.includes('fleetx') || normalized.includes('fleet')) return FLEETX_PROVIDER;
  throw new Error(`Unsupported GPS provider: ${provider}`);
}

function getProviderVehicleRegistryRecords(items = []) {
  const vehiclesByNumber = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const vehicleNumber = normalizeVehicleNumber(item?.vehicleNumber);
    if (!vehicleNumber) continue;

    const existing = vehiclesByNumber.get(vehicleNumber);
    if (existing) {
      if (!existing.driverName && item.driverName) existing.driverName = item.driverName;
      if (item.deviceNumber) existing.gpsDeviceId = item.deviceNumber;
      continue;
    }

    vehiclesByNumber.set(vehicleNumber, {
      vehicleNumber,
      driverName: item.driverName || '',
      gpsDeviceId: item.deviceNumber || '',
    });
  }
  return [...vehiclesByNumber.values()].map((record) => ({
    ...record,
    gpsDeviceId: record.gpsDeviceId || record.vehicleNumber,
  }));
}

async function syncProviderVehicleRegistry(items, provider) {
  const gpsProvider = getGpsProvider(provider);
  if (![WHEELSEYE_PROVIDER, FLEETX_PROVIDER].includes(gpsProvider)) {
    throw new Error(`Unsupported vehicle registry provider: ${provider}`);
  }

  const records = getProviderVehicleRegistryRecords(items);
  const existingVehicles = await Vehicle.find({}, 'vehicleNumber').lean();
  const existingNumberByCanonical = new Map(
    existingVehicles.map((vehicle) => [
      normalizeVehicleNumber(vehicle.vehicleNumber),
      vehicle.vehicleNumber,
    ])
  );
  for (const record of records) {
    const filter = {
      vehicleNumber: existingNumberByCanonical.get(record.vehicleNumber) || record.vehicleNumber,
    };
    const update = {
      $setOnInsert: {
        vehicleNumber: record.vehicleNumber,
        driverName: record.driverName,
        fleetType: 'Own Fleet',
        ownerName: '',
        mobile: '',
        gpsDeviceId: record.gpsDeviceId,
        gpsProvider: gpsProvider === FLEETX_PROVIDER ? 'fleetx' : 'wheelseye',
        status: 'Active',
      },
      $addToSet: { gpsProviders: gpsProvider },
    };

    try {
      await Vehicle.updateOne(filter, update, { upsert: true, setDefaultsOnInsert: false });
    } catch (error) {
      if (error.code !== 11000) throw error;
      await Vehicle.updateOne(filter, { $addToSet: { gpsProviders: gpsProvider } });
    }
    existingNumberByCanonical.set(record.vehicleNumber, filter.vehicleNumber);
  }
  return records.length;
}

function getSafeWheelsEyeError(error) {
  if (error?.response?.status) return `HTTP ${error.response.status}`;
  if (['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code)) return 'Request timed out';
  if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ERR_NETWORK'].includes(error?.code)) {
    return error.code;
  }
  return error?.code || 'REQUEST_FAILED';
}

/**
 * MAIN GPS SYNC PROCESSING SERVICE (Requirement 2)
 * Used by BOTH Automatic 30-min Background Scheduler and Manual "Sync GPS Now" button.
 *
 * Steps:
 * 1. Acquire Distributed DB Lock
 * 2. Load Active Vehicles and Active Plant Geofences
 * 3. Call Wheelseye API with 3 retries
 * 4. On WheelsEye failure: preserve last known GPS state and record the failure
 * 5. On API success:
 *    - Update vehicle location history without duplicates (checks vehicleId + gpsDateTime)
 *    - Evaluate Geofence: Inside DASNA Plant, Salt Plant, Tea Plant, or Outside
 *    - Update VehicleCurrentStatus table
 * 6. Update GpsSetting (last_evaluated_timestamp, next_scheduled_sync_at)
 * 7. Write to GpsSyncLog & CronExecutionLog
 * 8. Release Distributed Lock
 */
async function executeGpsSync({
  source = 'AUTO',
  triggerType = 'GPS_AUTO_SYNC_30MIN',
  slotKey = null,
  provider = WHEELSEYE_PROVIDER,
} = {}) {
  const gpsProvider = getGpsProvider(provider);
  const isWheelsEye = gpsProvider === WHEELSEYE_PROVIDER;
  const syncId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();
  const isAuto = source === 'AUTO';
  const syncType = isAuto ? 'AUTO' : 'MANUAL';
  const providerSlotKey = slotKey ? `${gpsProvider}:${slotKey}` : null;

  // 1. Acquire Distributed Lock (Requirement 12)
  const lockAcquired = await acquireDistributedLock(`${source}_${triggerType}`, gpsProvider);
  if (!lockAcquired) {
    console.log(`[GPS Sync] Skipped (${source}): Another sync job is currently running.`);
    return {
      success: false,
      inProgress: true,
      message: 'A GPS synchronization job is already in progress.',
    };
  }

  // Initial Log entries in DB (Requirement 11)
  let syncLogDoc = null;
  let cronLogDoc = null;
  try {
    if (providerSlotKey && await GpsSyncLog.exists({ slotKey: providerSlotKey, provider: gpsProvider })) {
      await releaseDistributedLock(gpsProvider);
      return {
        success: true,
        skipped: true,
        provider: gpsProvider,
        message: `IST slot ${slotKey} was already evaluated for ${gpsProvider}.`,
      };
    }
    syncLogDoc = await GpsSyncLog.create({
      syncId,
      startedAt,
      source: isAuto ? 'AUTO' : 'GPS-AUTO',
      syncType,
      triggerType,
      provider: gpsProvider,
      ...(providerSlotKey ? { slotKey: providerSlotKey } : {}),
      status: 'RUNNING',
    });
    cronLogDoc = await CronExecutionLog.create({
      jobName: `${gpsProvider} 30-Min Auto Sync`,
      provider: gpsProvider,
      triggerType,
      status: 'RUNNING',
      startedAt,
    });
  } catch (logInitErr) {
    console.warn('[Log Creation Warning]:', logInitErr.message);
  }

  try {
    // 2. Resolve GPS API configurations
    const allSettings = await GpsSetting.find({ archived: { $ne: true } });

    // 3. Load active plant geofences; vehicle status is rechecked after the API request.
    let activeVehicles = [];
    const activePlants = await Plant.find({ status: 'Active' });

    const vehicleByNumber = new Map();

    // 4. Fetch telemetry from this provider only.
    let rawVehicles = [];
    let rawSamples = [];
    let providerVehicles = [];
    let apiStatus = '200 OK';
    let fetchError = null;
    let providerStatus = null;

    try {
      const fetchResult = isWheelsEye
        ? await fetchWheelsEyeTelemetry(allSettings)
        : await fetchFleetxTelemetry(allSettings);
      rawVehicles = fetchResult.vehicles;
      rawSamples = fetchResult.samples;
      providerVehicles = fetchResult.providerVehicles || fetchResult.vehicles;
      providerStatus = fetchResult.providerStatus || fetchResult.wheelsEyeStatus || fetchResult.fleetXStatus;
      apiStatus = providerStatus.status;
    } catch (err) {
      fetchError = err;
      providerStatus = err.wheelsEyeStatus || err.fleetXStatus || {
        status: err.response?.status ? `HTTP ${err.response.status}` : 'REQUEST_FAILED',
        error: err.message || `${gpsProvider} request failed.`,
        count: 0,
        authFailed: err.response?.status === 401 || err.response?.status === 403,
        credentialSource: 'none',
      };
      apiStatus = `ERROR: ${err.message}`;
    }

    const syncTime = new Date();

    // 5. API Failure Handling (Requirement 5 & 19):
    // DO NOT mark vehicles outside! DO NOT overwrite valid previous coordinates with null/zeros!
    if (fetchError) {
      console.error(`[GPS Sync API Failure] (${gpsProvider}, ${source}): ${fetchError.message}`);

      await GpsSetting.findOneAndUpdate(
        buildProviderSettingQuery(gpsProvider),
        {
          $set: {
            provider: gpsProvider,
            connectionStatus: providerStatus.authFailed ? 'AUTH_FAILED' : 'Connection Failed',
            last_sync_status: 'FAILED',
            lastError: providerStatus.error || fetchError.message,
            lastErrorAt: syncTime,
            lastErrorCode: providerStatus.status,
            lastCredentialSource: providerStatus.credentialSource || 'none',
          },
          $inc: { consecutiveFailures: 1 },
        },
        { upsert: true }
      );

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      const nextSlot = getNextFixed30MinSlotIST(syncTime);

      if (syncLogDoc) {
        syncLogDoc.status = 'FAILED';
        syncLogDoc.completedAt = completedAt;
        syncLogDoc.executionTimeMs = durationMs;
        syncLogDoc.apiResponseStatus = apiStatus;
        syncLogDoc.errorMessage = fetchError.message;
        syncLogDoc.nextScheduledSyncAt = nextSlot;
        await syncLogDoc.save();
      }
      if (cronLogDoc) {
        cronLogDoc.status = 'FAILED';
        cronLogDoc.completedAt = completedAt;
        cronLogDoc.durationMs = durationMs;
        cronLogDoc.errorDetails = fetchError.message;
        await cronLogDoc.save();
      }

      const syncError = new Error(`${gpsProvider} API request failed: ${fetchError.message}`);
      syncError.provider = gpsProvider;
      syncError.providerStatus = providerStatus;
      throw syncError;
    }

    await GpsSetting.findOneAndUpdate(
      buildProviderSettingQuery(gpsProvider),
      {
        $set: {
          provider: gpsProvider,
          connectionStatus: 'Connected',
          lastSync: syncTime,
          lastSuccessAt: syncTime,
          lastConnectionCheckAt: syncTime,
          lastError: '',
          lastErrorCode: '',
          lastCredentialSource: providerStatus.credentialSource || 'none',
          consecutiveFailures: 0,
        },
      },
      { upsert: true }
    );

    const vehiclesRegistered = await syncProviderVehicleRegistry(providerVehicles, gpsProvider);

    // Recheck the register after the provider request so vehicles deactivated
    // while the request was in flight are excluded from this synchronization.
    activeVehicles = await Vehicle.find({ status: 'Active' });
    vehicleByNumber.clear();
    for (const vehicle of activeVehicles) {
      vehicleByNumber.set(normalizeVehicleNumber(vehicle.vehicleNumber), vehicle);
    }
    rawVehicles = filterTelemetryForActiveVehicles(rawVehicles, vehicleByNumber, gpsProvider);
    rawSamples = filterTelemetryForActiveVehicles(rawSamples, vehicleByNumber, gpsProvider);
    providerStatus.count = rawVehicles.length;

    // Persist every provider sample before selecting the newest point for current-state views.
    for (const item of rawSamples) {
      if (!item.vehicleNumber || !item.timestamp ||
          !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude) ||
          item.latitude < -90 || item.latitude > 90 ||
          item.longitude < -180 || item.longitude > 180 ||
          (item.latitude === 0 && item.longitude === 0)) {
        continue;
      }
      const cleanNumber = normalizeVehicleNumber(item.vehicleNumber);
      const vehicle = vehicleByNumber.get(cleanNumber);
      if (!vehicle) continue;
      const normalizedNumber = normalizeVehicleNumber(vehicle.vehicleNumber);
      const rawSpeed = item.rawTelemetry && Object.prototype.hasOwnProperty.call(item.rawTelemetry, 'speed')
        ? item.rawTelemetry.speed
        : item.speed;
      const rawIgnition = item.rawTelemetry && Object.prototype.hasOwnProperty.call(item.rawTelemetry, 'ignition')
        ? item.rawTelemetry.ignition
        : item.ignition;
      const historyPlantEval = getVehiclePlantStatus(
        { latitude: item.latitude, longitude: item.longitude, gpsTimestamp: item.timestamp },
        activePlants,
        { now: syncTime }
      );
      await GpsHistory.updateOne(
        {
          vehicleNumberNormalized: normalizedNumber,
          provider: item.provider,
          gpsTimestamp: item.timestamp,
        },
        {
          $setOnInsert: {
            ...(vehicle ? { vehicleId: vehicle._id } : {}),
            vehicleNumber: vehicle?.vehicleNumber || item.vehicleNumber,
            vehicleNumberNormalized: normalizedNumber,
            provider: item.provider,
            latitude: item.latitude,
            longitude: item.longitude,
            speed: rawSpeed ?? null,
            ignition: rawIgnition ?? null,
            gpsTimestamp: item.timestamp,
            syncTime,
            syncId,
            syncType,
            statusEligible: isValidFreshGpsTimestamp(item.timestamp, syncTime),
            geofence_status: historyPlantEval.isInside ? 'INSIDE' : 'OUTSIDE',
            plantId: historyPlantEval.plantId || null,
            plantName: historyPlantEval.isInside ? historyPlantEval.plantName : '',
            distanceMeter: historyPlantEval.distanceMeter,
            plantRadiusMeters: historyPlantEval.plantRadiusMeters,
            configuredPlantRadii: historyPlantEval.configuredPlantRadii,
            providerTransitionTimestamp: item.providerTransitionTimestamp || null,
            rawTelemetry: item.rawTelemetry || null,
          },
        },
        { upsert: true, sort: { updatedAt: -1 } }
      );
    }

    // 6. Process the newest provider point per active vehicle for current status.
    let processedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    let plantEntriesCount = 0;

    for (const item of rawVehicles) {
      if (!item.vehicleNumber) continue;
      const cleanNum = normalizeVehicleNumber(item.vehicleNumber);
      const vehicle = vehicleByNumber.get(cleanNum);
      if (!vehicle) continue;

      processedCount++;

      const lat = item.latitude;
      const lon = item.longitude;
      const hasCoordinates = typeof lat === 'number' && typeof lon === 'number' &&
        Number.isFinite(lat) && Number.isFinite(lon) &&
        lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
        !(lat === 0 && lon === 0);
      const deviceTimestamp = item.timestamp || null;
      if (!hasCoordinates || !deviceTimestamp) continue;
      if (!isValidFreshGpsTimestamp(deviceTimestamp, syncTime)) {
        failedCount++;
        continue;
      }
      const speed = item.speed;
      const ignition = item.ignition;
      const movementStatus = item.movementStatus || null;
      const address = item.address || (hasCoordinates ? getReadableLocation(lat, lon, activePlants) : '');

      // Geofence & Plant Status Calculation using SINGLE SOURCE OF TRUTH (geofenceService)
      const currentStatus = isWheelsEye
        ? await VehicleCurrentStatus.findOne({
            vehicleId: vehicle._id,
            provider: /wheels.?eye/i,
            archived: { $ne: true },
          })
        : null;
      const openProviderSession = await findOpenProviderZoneSession(vehicle.vehicleNumber, gpsProvider);
      let lastProviderTimestamp = currentStatus?.latest_gps_timestamp || openProviderSession?.lastSeenAt || null;
      if (!lastProviderTimestamp && !isWheelsEye) {
        const previousHistory = await GpsHistory.findOne({
          vehicleId: vehicle._id,
          provider: gpsProvider,
          syncId: { $ne: syncId },
          archived: { $ne: true },
        }).sort({ gpsTimestamp: -1 });
        lastProviderTimestamp = previousHistory?.gpsTimestamp || null;
      }
      if (lastProviderTimestamp && new Date(lastProviderTimestamp).getTime() > deviceTimestamp.getTime()) {
        continue;
      }
      if (lastProviderTimestamp && new Date(lastProviderTimestamp).getTime() === deviceTimestamp.getTime()) {
        if (!currentStatus) continue;
        await VehicleCurrentStatus.updateOne(
          { _id: currentStatus._id, latest_gps_timestamp: deviceTimestamp },
          {
            $set: {
              last_successful_sync_at: syncTime,
              last_sync_source: syncType,
              lastSyncId: syncId,
              lastSyncType: syncType,
              lastUpdatedAt: syncTime,
            },
          }
        );
        continue;
      }

      let entryDateTime = currentStatus ? currentStatus.lastEntryDateTime : null;
      let entryDetectedAt = currentStatus ? currentStatus.lastEntryDetectedAt : null;
      let entryGpsTimestamp = currentStatus ? currentStatus.lastEntryGpsTimestamp : null;
      let lastExitPlantName = currentStatus ? currentStatus.lastExitPlantName : null;
      let lastExitDateTime = currentStatus ? currentStatus.lastExitDateTime : null;
      let lastExitDetectedAt = currentStatus ? currentStatus.lastExitDetectedAt : null;
      let lastExitGpsTimestamp = currentStatus ? currentStatus.lastExitGpsTimestamp : null;

      const plantEval = getVehiclePlantStatus(
        { latitude: lat, longitude: lon, gpsTimestamp: deviceTimestamp, entryDateTime },
        activePlants,
        { now: syncTime }
      );

      const isInside = plantEval.isInside;
      const geofenceStatus = isInside ? 'INSIDE' : 'OUTSIDE';
      const plantId = plantEval.plantId;
      const plantName = isInside ? plantEval.plantName : '';
      const distanceMeter = plantEval.distanceMeter;
      const gpsFreshness = plantEval.gps_status;

      // Deduplication Guard (Requirement 2):
      // Check whether this exact vehicleId + gpsDateTime is already recorded.
      const existingLocation = hasCoordinates && deviceTimestamp
        ? await VehicleLocation.findOne({
            vehicleId: vehicle._id,
            gpsDateTime: deviceTimestamp,
            source: item.provider || 'WheelsEye GPS',
          })
        : null;

      if (hasCoordinates && deviceTimestamp && !existingLocation) {
        // Insert new location history record
        await VehicleLocation.create({
          vehicleId: vehicle._id,
          vehicleNumber: vehicle.vehicleNumber,
          latitude: lat,
          longitude: lon,
          gpsDateTime: deviceTimestamp,
          receivedAt: syncTime,
          speed,
          ignition,
          speedRaw: item.rawTelemetry && Object.prototype.hasOwnProperty.call(item.rawTelemetry, 'speed')
            ? item.rawTelemetry.speed
            : null,
          ignitionRaw: item.rawTelemetry && Object.prototype.hasOwnProperty.call(item.rawTelemetry, 'ignition')
            ? item.rawTelemetry.ignition
            : null,
          movementStatus,
          rawTelemetry: item.rawTelemetry || null,
          address,
          geofence_status: geofenceStatus,
          plant_id: plantId,
          plantName,
          plantRadiusMeters: plantEval.plantRadiusMeters,
          configuredPlantRadii: plantEval.configuredPlantRadii,
          syncId,
          syncType,
          sync_source: syncType,
          rawEventId: String(item.rawEventId || ''),
          source: item.provider || 'WheelsEye GPS',
          provider: item.provider || 'WheelsEye GPS',
          providerTransitionTimestamp: item.providerTransitionTimestamp || null,
          vehicleNumberNormalized: normalizeVehicleNumber(vehicle.vehicleNumber),
        });
      }

      const sessionResult = await reconcileZoneSession({
        vehicleId: vehicle._id,
        vehicleNumber: vehicle.vehicleNumber,
        zoneId: getZoneId(plantName, plantId),
        plantId,
        gpsTimestamp: deviceTimestamp,
        syncTime,
        syncId,
        syncType,
        providerTransitionTimestamp: item.providerTransitionTimestamp,
        provider: item.provider || 'WheelsEye GPS',
      }, currentStatus);
      const { session, action: sessionAction, previousSession } = sessionResult;
      if (!session) {
        throw new Error(`Failed to reconcile zone session for ${vehicle.vehicleNumber}.`);
      }

      if (isInside) {
        if (sessionAction === 'open' || sessionAction === 'transition') {
          entryDateTime = session.enteredAt;
          entryGpsTimestamp = session.entryGpsTimestamp || session.enteredAt;
          entryDetectedAt = session.detectedAt || syncTime;
          if (isWheelsEye && entryDateTime && hasCoordinates) {
            await PlantEntry.create({
              vehicleId: vehicle._id,
              vehicleNumber: vehicle.vehicleNumber,
              plantId,
              plantName,
              entryDateTime,
              detectedAt: entryDetectedAt,
              gpsTimestamp: entryGpsTimestamp,
              providerTransitionTimestamp: item.providerTransitionTimestamp || null,
              syncTime,
              syncId,
              syncType,
              latitude: lat,
              longitude: lon,
              distanceMeter,
              plantRadiusMeters: plantEval.plantRadiusMeters,
            });
            plantEntriesCount++;
            console.log(`[Plant Entry] ${vehicle.vehicleNumber} entered ${plantName} at ${entryDateTime.toISOString()}`);
          }
        } else {
          entryDateTime = session?.enteredAt || currentStatus?.lastEntryDateTime || deviceTimestamp;
          entryGpsTimestamp = session?.entryGpsTimestamp || session?.enteredAt ||
            currentStatus?.lastEntryGpsTimestamp || currentStatus?.lastEntryDateTime || deviceTimestamp;
          entryDetectedAt = session?.detectedAt || currentStatus?.lastEntryDetectedAt ||
            currentStatus?.lastEntryDateTime || deviceTimestamp;
        }
      } else {
        // Transitioned to Outside: Record exit timestamp and plant name
        const exitedPlant = sessionAction === 'transition' && previousSession?.zoneId !== 'OUTSIDE' ||
          sessionAction === 'open' && currentStatus?.status === 'Inside';
        const previousPlantId = previousSession?.plantId || currentStatus?.currentPlantId;
        if (hasCoordinates && exitedPlant && previousPlantId) {
          const prevPlant = await Plant.findById(previousPlantId);
          lastExitPlantName = prevPlant ? prevPlant.plantName : currentStatus?.current_plant;
          lastExitDateTime = deviceTimestamp;
          lastExitGpsTimestamp = deviceTimestamp;
          lastExitDetectedAt = syncTime;
        }
        entryDateTime = null;
        entryGpsTimestamp = null;
        entryDetectedAt = null;
      }

      // Calculate stay duration using real GPS timestamps (frozen if GPS STALE)
      if (isInside) {
        entryGpsTimestamp = entryGpsTimestamp || session.entryGpsTimestamp || session.enteredAt || deviceTimestamp;
        entryDetectedAt = entryDetectedAt || session.detectedAt ||
          currentStatus?.lastEntryDetectedAt || currentStatus?.lastEntryDateTime ||
          session.enteredAt || deviceTimestamp;
      }
      entryDateTime = isInside ? session?.enteredAt || entryDateTime : null;
      const stayHours = isInside
        ? calculateStayDuration(entryDateTime, deviceTimestamp)
        : '00:00';

      const updatePayload = {
        vehicleNumber: vehicle.vehicleNumber,
        currentPlantId: plantId,
        current_plant: plantName || null,
        current_geofence: geofenceStatus,
        status: isInside ? 'Inside' : 'Outside',
        latitude: lat,
        longitude: lon,
        distanceMeter,
        plantRadiusMeters: plantEval.plantRadiusMeters,
        configuredPlantRadii: plantEval.configuredPlantRadii,
        latest_gps_timestamp: deviceTimestamp,
        last_successful_sync_at: syncTime,
        gps_status: gpsFreshness,
        last_sync_source: syncType,
        lastSyncId: syncId,
        lastSyncType: syncType,
        stayHours,
        speed,
        ignition,
        speedRaw: item.rawTelemetry && Object.prototype.hasOwnProperty.call(item.rawTelemetry, 'speed')
          ? item.rawTelemetry.speed
          : null,
        ignitionRaw: item.rawTelemetry && Object.prototype.hasOwnProperty.call(item.rawTelemetry, 'ignition')
          ? item.rawTelemetry.ignition
          : null,
        movementStatus: item.movementStatus || null,
        provider: item.provider || null,
        rawTelemetry: item.rawTelemetry || null,
        address,
        lastEntryDateTime: entryDateTime,
        lastEntryDetectedAt: entryDetectedAt,
        lastEntryGpsTimestamp: entryGpsTimestamp,
        lastExitPlantName,
        lastExitDateTime,
        lastExitDetectedAt,
        lastExitGpsTimestamp,
        lastUpdatedAt: syncTime,
      };

      if (isWheelsEye) {
        if (currentStatus) {
          Object.assign(currentStatus, updatePayload);
          await currentStatus.save();
        } else {
          await VehicleCurrentStatus.create({
            vehicleId: vehicle._id,
            ...updatePayload,
          });
        }
      }

      updatedCount++;
    }

    if (isWheelsEye) {
      for (const vehicle of activeVehicles) {
        await rebuildPlantStays(vehicle._id);
      }
    }

    let reportsRebuilt = false;
    let reportRebuildError = null;
    if (isWheelsEye) {
      try {
        const affectedDates = rawSamples
          .filter((item) => item.timestamp)
          .map((item) => istDateString(item.timestamp));
        affectedDates.push(istDateString(syncTime));
        const expandedDates = affectedDates.flatMap((date) => {
          const [year, month, day] = date.split('-').map(Number);
          return [-1, 0, 1].map((offset) => {
            const shifted = new Date(Date.UTC(year, month - 1, day + offset));
            return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
          });
        });
        const todayDate = istDateString(syncTime);
        const reportDates = [...new Set(expandedDates.filter((date) => date <= todayDate))].sort();
        await rebuildDailyGpsReports({
          fromDate: reportDates[0],
          toDate: reportDates[reportDates.length - 1],
        });
        reportsRebuilt = true;
      } catch (error) {
        reportRebuildError = error.message;
        console.error('[GPS Report Rebuild Error]:', error);
      }
    }

    // 8. Automated Driver-to-Vehicle Assignment using GPS Proximity
    let assignmentStats = null;
    if (isWheelsEye) {
      try {
        assignmentStats = await executeAutomatedDriverAssignment();
      } catch (assignmentErr) {
        console.error('[GPS Sync Driver Assignment Error]:', assignmentErr.message);
      }
    }

    // 9. Next scheduled 30-minute slot in Asia/Kolkata (IST)
    const nextSlot = getNextFixed30MinSlotIST(syncTime);

    // 10. Update this provider's setting and sync health.
    const settingUpdate = {
      provider: gpsProvider,
      connectionStatus: 'Connected',
      next_scheduled_sync_at: nextSlot,
      reportsRebuilt,
      reportRebuildError,
      last_sync_source: syncType,
      pollIntervalSeconds: 1800,
      lastSync: syncTime,
      lastSuccessAt: syncTime,
      last_evaluated_timestamp: syncTime,
      last_sync_status: 'SUCCESS',
      lastError: '',
      lastErrorCode: '',
      lastCredentialSource: providerStatus.credentialSource || 'none',
      consecutiveFailures: 0,
      vehicles_processed: providerStatus.count,
      vehicles_updated: updatedCount,
    };

    await GpsSetting.findOneAndUpdate(
      buildProviderSettingQuery(gpsProvider),
      { $set: settingUpdate },
      { upsert: true, sort: { updatedAt: -1 } }
    );

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // 11. Update Sync Logs (Requirement 9 & 11)
    if (syncLogDoc) {
      syncLogDoc.status = 'SUCCESS';
      syncLogDoc.completedAt = completedAt;
      syncLogDoc.vehiclesFound = rawVehicles.length;
      syncLogDoc.vehiclesProcessed = processedCount;
      syncLogDoc.vehiclesUpdated = updatedCount;
      syncLogDoc.vehiclesFailed = failedCount;
      syncLogDoc.plantEntriesRecorded = plantEntriesCount;
      syncLogDoc.apiResponseStatus = apiStatus;
      syncLogDoc.executionTimeMs = durationMs;
      syncLogDoc.lastEvaluatedTimestamp = syncTime;
      syncLogDoc.nextScheduledSyncAt = nextSlot;
      if (assignmentStats) {
        syncLogDoc.driversChecked = assignmentStats.driversChecked || 0;
        syncLogDoc.vehiclesChecked = assignmentStats.vehiclesChecked || 0;
        syncLogDoc.eligibleMatches = assignmentStats.eligibleMatches || 0;
        syncLogDoc.autoAssignmentsCompleted = assignmentStats.autoAssignmentsCompleted || 0;
        syncLogDoc.vehiclesWithMultipleDrivers = assignmentStats.vehiclesWithMultipleDrivers || 0;
        syncLogDoc.comparisonsSkipped = assignmentStats.comparisonsSkipped || 0;
        syncLogDoc.skippedReasons = assignmentStats.skippedReasons || [];
        syncLogDoc.assignmentConflicts = assignmentStats.assignmentConflicts || [];
      }
      await syncLogDoc.save();
    }

    if (cronLogDoc) {
      cronLogDoc.status = 'SUCCESS';
      cronLogDoc.completedAt = completedAt;
      cronLogDoc.durationMs = durationMs;
      cronLogDoc.totalVehiclesFetched = rawVehicles.length;
      cronLogDoc.vehiclesProcessed = processedCount;
      cronLogDoc.plantEntriesCount = plantEntriesCount;
      cronLogDoc.lastEvaluatedTimestamp = syncTime;
      await cronLogDoc.save();
    }

    const istTimeString = syncTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    console.log(
      `[GPS Sync SUCCESS] [${istTimeString}] Source: ${source}. Processed: ${processedCount}, Updated: ${updatedCount}, Auto-assigned Drivers: ${assignmentStats?.autoAssignmentsCompleted ?? 0}, Multiple Driver Matches: ${assignmentStats?.vehiclesWithMultipleDrivers ?? 0}, Duration: ${durationMs}ms.`
    );

    return {
      success: true,
      syncId,
      source,
      triggerType,
      startedAt,
      completedAt,
      durationMs,
      vehiclesFound: rawVehicles.length,
      vehiclesRegistered,
      vehiclesProcessed: processedCount,
      vehiclesUpdated: updatedCount,
      vehiclesFailed: failedCount,
      plantEntriesRecorded: plantEntriesCount,
      driverAssignment: assignmentStats,
      last_evaluated_timestamp: syncTime,
      last_successful_sync_at: syncTime,
      next_scheduled_sync_at: nextSlot,
      provider: gpsProvider,
      providerStatus,
      wheelsEyeStatus: providerStatus,
      syncType,
    };
  } finally {
    // Always release distributed lock
    await releaseDistributedLock(gpsProvider);
  }
}

async function executeGpsSyncForBothProviders(options = {}) {
  const providers = [
    { name: WHEELSEYE_PROVIDER, promise: executeGpsSync({ ...options, provider: WHEELSEYE_PROVIDER }) },
    { name: FLEETX_PROVIDER, promise: executeGpsSync({ ...options, provider: FLEETX_PROVIDER }) },
  ];
  const results = await Promise.allSettled(providers.map(({ promise }) => promise));
  const providerResults = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return { provider: providers[index].name, ...result.value };
    }
    const reason = result.reason;
    console.error(`[GPS Sync] ${providers[index].name} synchronization failed: ${reason?.message || 'Unknown error'}`);
    return {
      provider: providers[index].name,
      success: false,
      message: reason?.message || `${providers[index].name} synchronization failed.`,
      error: reason?.message || 'Unknown error',
    };
  });
  const wheelsResult = providerResults[0];
  const fleetXResult = providerResults[1];

  return {
    success: wheelsResult.success && fleetXResult.success,
    providerResults,
    message: wheelsResult.success && fleetXResult.success
      ? 'WheelsEye and FleetX GPS synchronization completed.'
      : 'GPS synchronization completed with partial provider results.',
    last_evaluated_timestamp: wheelsResult.last_evaluated_timestamp || fleetXResult.last_evaluated_timestamp || null,
    last_successful_sync_at: wheelsResult.last_successful_sync_at || fleetXResult.last_successful_sync_at || null,
    next_scheduled_sync_at: wheelsResult.next_scheduled_sync_at || fleetXResult.next_scheduled_sync_at || null,
    processedCount: (wheelsResult.vehiclesProcessed || 0) + (fleetXResult.vehiclesProcessed || 0),
    vehiclesProcessed: (wheelsResult.vehiclesProcessed || 0) + (fleetXResult.vehiclesProcessed || 0),
  };
}

/**
 * Retrieves the comprehensive auto-sync state for dashboard and health inspection (Requirement 10).
 */
async function getAutoSyncStatus(provider = WHEELSEYE_PROVIDER) {
  const gpsProvider = getGpsProvider(provider);
  const providerQueries = {
    [WHEELSEYE_PROVIDER]: { provider: /wheels.?eye/i, apiUrl: /wheelseye/i },
    [FLEETX_PROVIDER]: { provider: /fleetx|fleet/i, apiUrl: /fleetx|fleet/i },
  };
  const queryMatcher = providerQueries[gpsProvider] || providerQueries[WHEELSEYE_PROVIDER];
  const settings = await GpsSetting.find({
    archived: { $ne: true },
    $or: [{ provider: queryMatcher.provider }, { apiUrl: queryMatcher.apiUrl }],
  });
  const setting = settings.find((s) => s.status === 'Active') || settings[0];
  const recentLog = await GpsSyncLog.findOne({
    provider: queryMatcher.provider,
    archived: { $ne: true },
  }).sort({ startedAt: -1 });
  const recentSuccessfulLog = await GpsSyncLog.findOne({
    status: 'SUCCESS',
    provider: queryMatcher.provider,
    archived: { $ne: true },
  }).sort({ completedAt: -1 });
  const lock = await GpsSyncLock.findById(getProviderLockId(gpsProvider));
  const lastSource = recentLog?.syncType || setting?.last_sync_source || recentLog?.source;
  const providerRegex = queryMatcher.provider;

  const now = new Date();
  const nextScheduled = getNextFixed30MinSlotIST(now);

  const isLockActive = Boolean(lock && lock.isLocked && lock.expiresAt && lock.expiresAt > now);
  return {
    auto_sync_enabled: Boolean(setting && setting.status === 'Active'),
    interval_minutes: 30,
    timezone: 'Asia/Kolkata',
    last_sync_started_at: recentLog?.startedAt || setting?.lastSync || null,
    last_sync_completed_at: recentLog?.completedAt || setting?.lastSync || null,
    last_successful_sync_at: recentSuccessfulLog?.lastEvaluatedTimestamp || null,
    next_scheduled_sync_at: nextScheduled,
    last_sync_status: recentLog?.status || setting?.last_sync_status || 'IDLE',
    last_sync_source: ['AUTO', 'MANUAL'].includes(lastSource)
      ? lastSource
      : lastSource
        ? 'GPS-AUTO'
        : 'AUTO',
    vehicles_processed: setting?.vehicles_processed ?? recentLog?.vehiclesProcessed ?? 0,
    vehicles_updated: setting?.vehicles_updated ?? recentLog?.vehiclesUpdated ?? 0,
    vehicles_failed: setting?.vehicles_failed ?? recentLog?.vehiclesFailed ?? 0,
    is_syncing: isLockActive,
    provider: gpsProvider,
    connection_status: getGpsConnectionStatus(setting, gpsProvider),
  };
}

module.exports = {
  executeGpsSync,
  executeGpsSyncForBothProviders,
  getAutoSyncStatus,
  getNextFixed30MinSlotIST,
  acquireDistributedLock,
  releaseDistributedLock,
  DEFAULT_WHEELSEYE_URL,
  fetchWheelsEyeTelemetry,
  fetchFleetxTelemetry,
  fetchWheelseyeTelemetryWithRetries,
  fetchFleetxTelemetryWithRetries,
  fetchFleetxVehicleTelemetry,
  getFleetxVehicleUrl,
  findOpenProviderZoneSession,
  parseTelematicsTimestamp,
  normalizeWheelseyeItem,
  getGpsProvider,
  getProviderVehicleRegistryRecords,
  syncProviderVehicleRegistry,
  getProviderLockId,
  selectLatestTelemetryByVehicle,
  filterTelemetryForActiveVehicles,
};
