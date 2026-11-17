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

const DEFAULT_WHEELSEYE_URL = (process.env.WHEELSEYE_API_URL || '').trim();
const DEFAULT_FLEETX_URL = (process.env.FLEETX_API_URL || 'https://api.fleetx.io/api/v1/analytics/live').trim();
const WHEELSEYE_PROVIDER = 'WheelsEye GPS';
const FLEETX_PROVIDER = 'Fleetx';

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

function filterTelemetryForActiveVehicles(items, vehiclesByNumber) {
  return items.filter((item) => {
    const vehicle = vehiclesByNumber.get(normalizeVehicleNumber(item.vehicleNumber));
    return vehicle?.status === 'Active';
  });
}

/**
 * Fetches the single WheelsEye telemetry source.
 */
async function fetchWheelsEyeTelemetry(gpsSettings = []) {
  const weConfig = gpsSettings.find(
    (s) => s.provider && (s.provider.toLowerCase().includes('wheels') || (s.apiUrl && s.apiUrl.includes('wheelseye')))
  );
  let weUrl = (process.env.WHEELSEYE_API_URL || '').trim() || weConfig?.apiUrl || DEFAULT_WHEELSEYE_URL;
  if (!weUrl || weUrl.includes('••••')) {
    weUrl = DEFAULT_WHEELSEYE_URL;
  }
  const weActive = weConfig ? weConfig.status === 'Active' : true;
  const weEnvToken = (process.env.WHEELSEYE_API_KEY || '').trim();
  const weEnvUrlToken = getWheelsEyeUrlToken(process.env.WHEELSEYE_API_URL || '');
  const weSavedUrlToken = getWheelsEyeUrlToken(weConfig?.apiUrl || '');
  const weToken = weEnvToken || weEnvUrlToken ||
    decryptGpsCredential(weConfig?.encryptedApiKey || '').trim() || weSavedUrlToken;
  const weUrlHasCredential = Boolean(weEnvUrlToken || weSavedUrlToken);
  const weCredentialSource = weEnvToken
    ? 'WHEELSEYE_API_KEY'
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
    wheelsEyeStatus,
    providerStatus: wheelsEyeStatus,
    totalRawCount: items.length,
  };
}

async function fetchFleetxTelemetryWithRetries(apiUrl, token, maxAttempts = 3) {
  apiUrl = typeof apiUrl === 'string' ? apiUrl.trim() : '';
  token = typeof token === 'string' ? token.trim() : '';
  if (!apiUrl || !isSafeExternalUrl(apiUrl)) {
    throw new Error('Refusing to query unsafe or invalid FleetX GPS API URL.');
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** (attempt - 2))));
    try {
      const response = await axios.get(apiUrl, {
        timeout: 15000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SikkaFleet-GpsSync/2.0',
          ...(token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
        },
      });
      const list = Array.isArray(response.data?.vehicles)
        ? response.data.vehicles
        : Array.isArray(response.data?.data?.vehicles)
          ? response.data.data.vehicles
          : Array.isArray(response.data)
            ? response.data
            : null;
      if (!list) throw new Error(`Unexpected payload structure from FleetX API (status: ${response.status}).`);
      logRawTelemetrySample('Fleetx', list);
      return { list, status: `${response.status} OK` };
    } catch (error) {
      lastError = error;
      console.warn(`[FleetX API Attempt ${attempt} Failed]: ${getSafeFleetxError(error)}`);
      const status = error.response?.status;
      if (status === 401 || status === 403 || (status && status < 500 && status !== 429)) break;
    }
  }
  throw lastError;
}

function normalizeFleetxItem(item) {
  const statusFields = [item.status, item.otherAttributes?.actualStatus, item.currentStatus]
    .filter((value) => typeof value === 'string');
  const statusIgnition = statusFields
    .map((value) => (/^ignition on$/i.test(value.trim()) ? true : /^ignition off$/i.test(value.trim()) ? false : null))
    .find((value) => value !== null);
  const ignition = [item.otherAttributes?.ignition, item.ignition]
    .map(parseTelemetryBoolean)
    .find((value) => value !== null) ?? statusIgnition ?? null;
  const movementStatus = [
    item.movementStatus,
    item.movement_status,
    item.motionStatus,
    item.status,
    item.currentStatus,
    item.otherAttributes?.actualStatus,
  ].map(normalizeVendorMovementStatus).find((value) => value !== null) || null;

  return {
    vehicleNumber: normalizeVehicleNumber(item.vehicleNumber),
    driverName: item.driverName ? String(item.driverName).trim() : '',
    latitude: parseTelemetryNumber(item.latitude),
    longitude: parseTelemetryNumber(item.longitude),
    speed: parseTelemetryNumber(item.speed),
    ignition,
    movementStatus,
    deviceNumber: item.deviceId || item.otherAttributes?.imei || '',
    vendorName: 'Fleetx',
    vehicleType: item.vehicleTypeValue || item.vehicleMake || null,
    angle: parseTelemetryNumber(item.otherAttributes?.course),
    chargeOn: parseTelemetryBoolean(item.otherAttributes?.power),
    timestamp: parseTelematicsTimestamp(item),
    providerTransitionTimestamp: item.transitionTimestamp
      ? parseTelematicsTimestamp({ gpsTimestamp: item.transitionTimestamp })
      : null,
    address: item.address || '',
    provider: FLEETX_PROVIDER,
    rawTelemetry: {
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
      speed: item.speed ?? null,
      ignition: item.ignition ?? item.otherAttributes?.ignition ?? null,
      status: item.status ?? item.currentStatus ?? item.otherAttributes?.actualStatus ?? null,
      movementStatus: item.movementStatus ?? item.movement_status ?? item.motionStatus ?? null,
      timestamp: item.gpsTimestamp ?? item.gpsTime ?? item.lastGpsTimestamp ??
        item.dttimeInEpoch ?? item.dttime ?? item.lastUpdatedAt ?? item.lastStatusTime ??
        item.createdDateReadable ?? item.timestamp ?? null,
    },
    rawEventId: String(item.lastUpdatedAt || item.lastStatusTime || item.otherAttributes?.serverTime || ''),
  };
}

function getSafeFleetxError(error) {
  if (error?.response?.status) return `HTTP ${error.response.status}`;
  if (error?.code === 'ECONNABORTED') return 'Request timed out';
  return 'FleetX request failed';
}

async function fetchFleetxTelemetry(gpsSettings = []) {
  const config = gpsSettings.find((setting) =>
    /fleetx/i.test(setting.provider || '') || /fleetx/i.test(setting.apiUrl || '')
  );
  const apiUrl = (process.env.FLEETX_API_URL || '').trim() || config?.apiUrl || DEFAULT_FLEETX_URL;
  const token = (process.env.FLEETX_API_KEY || process.env.FLEETX_BEARER_TOKEN || '').trim() ||
    decryptGpsCredential(config?.encryptedApiKey || '').trim();
  const active = config ? config.status === 'Active' : Boolean(token);
  const credentialSource = (process.env.FLEETX_API_KEY || '').trim()
    ? 'FLEETX_API_KEY'
    : (process.env.FLEETX_BEARER_TOKEN || '').trim()
      ? 'FLEETX_BEARER_TOKEN'
      : token
        ? 'GPS settings'
        : 'none';

  if (!active || !token) {
    const error = new Error(!active ? 'FleetX GPS provider is inactive.' : 'FleetX GPS API token is not configured.');
    error.fleetxStatus = {
      status: !active ? 'INACTIVE' : 'NOT_CONFIGURED',
      error: error.message,
      count: 0,
      authFailed: false,
      apiUrl: maskUrlSecret(apiUrl),
      credentialSource,
    };
    throw error;
  }

  let response;
  try {
    response = await fetchFleetxTelemetryWithRetries(apiUrl, token, 3);
  } catch (requestError) {
    const statusCode = requestError.response?.status;
    const error = new Error(statusCode
      ? `FleetX request failed with HTTP ${statusCode}.`
      : `FleetX request failed: ${getSafeFleetxError(requestError)}.`);
    error.fleetxStatus = {
      status: statusCode ? `HTTP ${statusCode}` : getSafeFleetxError(requestError),
      error: error.message,
      count: 0,
      authFailed: statusCode === 401 || statusCode === 403,
      apiUrl: maskUrlSecret(apiUrl),
      credentialSource,
    };
    throw error;
  }

  const items = response.list.map(normalizeFleetxItem);
  const validItems = items.filter((item) => item.vehicleNumber && item.timestamp &&
    Number.isFinite(item.latitude) && Number.isFinite(item.longitude) &&
    item.latitude >= -90 && item.latitude <= 90 &&
    item.longitude >= -180 && item.longitude <= 180 &&
    !(item.latitude === 0 && item.longitude === 0));
  const latestVehicles = selectLatestTelemetryByVehicle(validItems);
  return {
    vehicles: latestVehicles,
    samples: validItems,
    providerStatus: {
      status: response.status,
      error: null,
      count: latestVehicles.length,
      authFailed: false,
      apiUrl: maskUrlSecret(apiUrl),
      credentialSource,
    },
    totalRawCount: items.length,
  };
}

function getGpsProvider(provider = WHEELSEYE_PROVIDER) {
  const normalized = String(provider).toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.includes('wheels')) return WHEELSEYE_PROVIDER;
  if (normalized.includes('fleetx')) return FLEETX_PROVIDER;
  throw new Error(`Unsupported GPS provider: ${provider}`);
}

function getSafeWheelsEyeError(error) {
  if (error?.response?.status) return `HTTP ${error.response.status}`;
  if (error?.code === 'ECONNABORTED') return 'Request timed out';
  return 'WheelsEye request failed';
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
    let apiStatus = '200 OK';
    let fetchError = null;
    let providerStatus = null;

    try {
      const fetchResult = isWheelsEye
        ? await fetchWheelsEyeTelemetry(allSettings)
        : await fetchFleetxTelemetry(allSettings);
      rawVehicles = fetchResult.vehicles;
      rawSamples = fetchResult.samples;
      providerStatus = fetchResult.providerStatus || fetchResult.wheelsEyeStatus;
      apiStatus = providerStatus.status;
    } catch (err) {
      fetchError = err;
      providerStatus = err.wheelsEyeStatus || err.fleetxStatus || {
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
        {
          archived: { $ne: true },
          $or: [
            { provider: new RegExp(gpsProvider === FLEETX_PROVIDER ? 'fleetx' : 'wheels.?eye', 'i') },
            { apiUrl: new RegExp(gpsProvider === FLEETX_PROVIDER ? 'fleetx' : 'wheelseye', 'i') },
          ],
        },
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

    // Recheck the register after the provider request so vehicles deactivated
    // while the request was in flight are excluded from this synchronization.
    activeVehicles = await Vehicle.find({ status: 'Active' });
    vehicleByNumber.clear();
    for (const vehicle of activeVehicles) {
      vehicleByNumber.set(normalizeVehicleNumber(vehicle.vehicleNumber), vehicle);
    }
    rawVehicles = filterTelemetryForActiveVehicles(rawVehicles, vehicleByNumber);
    rawSamples = filterTelemetryForActiveVehicles(rawSamples, vehicleByNumber);
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
        { upsert: true }
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
      const openProviderSession = await ZoneSession.findOne({
        vehicleNumberNormalized: normalizeVehicleNumber(vehicle.vehicleNumber),
        provider: gpsProvider,
        exitedAt: null,
        archived: { $ne: true },
      }).sort({ enteredAt: -1 });
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
      {
        archived: { $ne: true },
        $or: [
          { provider: new RegExp(gpsProvider === FLEETX_PROVIDER ? 'fleetx' : 'wheels.?eye', 'i') },
          { apiUrl: new RegExp(gpsProvider === FLEETX_PROVIDER ? 'fleetx' : 'wheelseye', 'i') },
        ],
      },
      { $set: settingUpdate },
      { upsert: true }
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
      ...(isWheelsEye ? { wheelsEyeStatus: providerStatus } : { fleetxStatus: providerStatus }),
      syncType,
    };
  } finally {
    // Always release distributed lock
    await releaseDistributedLock(gpsProvider);
  }
}

async function executeGpsSyncForBothProviders(options = {}) {
  const providers = [WHEELSEYE_PROVIDER, FLEETX_PROVIDER];
  const providerResults = await Promise.all(providers.map(async (provider) => {
    try {
      return { provider, ...(await executeGpsSync({ ...options, provider })) };
    } catch (error) {
      return {
        provider,
        success: false,
        error: error.message || `${provider} synchronization failed.`,
        providerStatus: error.providerStatus || null,
      };
    }
  }));
  const success = providerResults.every((result) =>
    (result.success && !result.inProgress) || result.skipped
  );
  return {
    success,
    providerResults,
    message: success
      ? 'Both GPS providers completed synchronization.'
      : 'One or more GPS providers failed to synchronize.',
  };
}

/**
 * Retrieves the comprehensive auto-sync state for dashboard and health inspection (Requirement 10).
 */
async function getAutoSyncStatus(provider = WHEELSEYE_PROVIDER) {
  const gpsProvider = getGpsProvider(provider);
  const providerRegex = new RegExp(gpsProvider === FLEETX_PROVIDER ? 'fleetx' : 'wheels.?eye', 'i');
  const apiUrlRegex = new RegExp(gpsProvider === FLEETX_PROVIDER ? 'fleetx' : 'wheelseye', 'i');
  const settings = await GpsSetting.find({
    archived: { $ne: true },
    $or: [{ provider: providerRegex }, { apiUrl: apiUrlRegex }],
  });
  const setting = settings.find((s) => s.status === 'Active') || settings[0];
  const recentLog = await GpsSyncLog.findOne({
    provider: providerRegex,
    archived: { $ne: true },
  }).sort({ startedAt: -1 });
  const recentSuccessfulLog = await GpsSyncLog.findOne({
    status: 'SUCCESS',
    provider: providerRegex,
    archived: { $ne: true },
  }).sort({ completedAt: -1 });
  const lock = await GpsSyncLock.findById(getProviderLockId(gpsProvider));
  const lastSource = recentLog?.syncType || setting?.last_sync_source || recentLog?.source;

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
    connection_status: settings.some((s) => s.connectionStatus === 'Connected') ? 'Connected' : (setting?.connectionStatus || 'Pending'),
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
  DEFAULT_FLEETX_URL,
  fetchWheelsEyeTelemetry,
  fetchFleetxTelemetry,
  fetchWheelseyeTelemetryWithRetries,
  fetchFleetxTelemetryWithRetries,
  parseTelematicsTimestamp,
  normalizeWheelseyeItem,
  normalizeFleetxItem,
  getGpsProvider,
  getProviderLockId,
  selectLatestTelemetryByVehicle,
  filterTelemetryForActiveVehicles,
};
