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
const { calculateHaversineDistance, getVehiclePlantStatus, calculateStayDuration } = require('./geofenceService');
const { getReadableLocation } = require('./locationHelper');
const { isSafeExternalUrl } = require('../utils/security');
const { executeAutomatedDriverAssignment } = require('./driverMatchingService');
const {
  parseTelemetryNumber,
  parseTelemetryBoolean,
  normalizeVendorMovementStatus,
  resolveMovementStatus,
} = require('./telemetryValues');
const { maskUrlSecret } = require('../utils/security');
const { normalizeVehicleNumber } = require('./gpsTimelineService');
const { rebuildPlantStays } = require('./gpsDataService');
const { rebuildDailyGpsReports } = require('./reportCalculationService');
const { istDateString } = require('./gpsTimelineService');

const DEFAULT_WHEELSEYE_URL =
  process.env.WHEELSEYE_API_URL ||
  '';

const DEFAULT_FLEETX_URL =
  process.env.FLEETX_API_URL ||
  'https://api.fleetx.io/api/v1/analytics/live';

const DEFAULT_FLEETX_TOKEN =
  process.env.FLEETX_API_KEY ||
  process.env.FLEETX_BEARER_TOKEN ||
  '';

const LOCK_ID = 'gps_sync_lock';
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes safety timeout
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes = GPS Stale
const rawSampleLogged = new Set();

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
 * or provider-specific time fields from WheelsEye and Fleetx.
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
    const utcTimestamp = /(?:z|[+-]\d{2}:?\d{2})$/i.test(timestamp)
      ? timestamp
      : `${timestamp.replace(' ', 'T')}Z`;
    const date = new Date(utcTimestamp);
    if (!isNaN(date.getTime())) return date;
  }
  return null;
}

const parseWheelseyeTimestamp = parseTelematicsTimestamp;

/**
 * Acquires distributed database lock.
 * Returns true if lock was acquired, false if already locked by another worker.
 */
async function acquireDistributedLock(callerName = 'Worker') {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TIMEOUT_MS);

  try {
    const doc = await GpsSyncLock.findOneAndUpdate(
      {
        _id: LOCK_ID,
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
          lockedBy: callerName,
          expiresAt,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
    return Boolean(doc);
  } catch (err) {
    // E11000 duplicate key or concurrency collision -> another worker acquired lock
    return false;
  }
}

/**
 * Releases distributed database lock.
 */
async function releaseDistributedLock() {
  try {
    await GpsSyncLock.updateOne(
      { _id: LOCK_ID },
      {
        $set: {
          isLocked: false,
          expiresAt: new Date(0),
        },
      }
    );
  } catch (err) {
    console.warn('[Distributed Lock Release Warning]:', err.message);
  }
}

/**
 * Calls Wheelseye GPS Telemetry endpoint with 3 retry attempts (Requirement 4).
 */
async function fetchWheelseyeTelemetryWithRetries(apiUrl, maxAttempts = 3, apiKey = '') {
  if (!apiUrl || !isSafeExternalUrl(apiUrl)) {
    throw new Error('Refusing to query unsafe or invalid GPS API URL.');
  }
  const requestUrl = new URL(apiUrl);
  if (apiKey && !requestUrl.searchParams.has('accessToken')) {
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
      console.warn(`[Wheelseye API Attempt ${attempt} Failed]: ${redactSensitiveFields(err.message)}`);
      const status = err.response?.status;
      if (status === 401 || status === 403 || (status && status < 500 && status !== 429)) break;
    }
  }

  throw lastErr;
}

/**
 * Calls Fleetx GPS Analytics / Live Telematics endpoint with 3 retry attempts.
 */
async function fetchFleetxTelemetryWithRetries(apiUrl, token, maxAttempts = 3) {
  if (!apiUrl || !isSafeExternalUrl(apiUrl)) {
    throw new Error('Refusing to query unsafe or invalid Fleetx GPS API URL.');
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const delay = attempt === 1 ? 0 : 1000 * (2 ** (attempt - 2));
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      console.log(`[Fleetx API] Attempt ${attempt}/${maxAttempts} requesting ${maskUrlSecret(apiUrl)}...`);
      const headers = {
        Accept: 'application/json',
        'User-Agent': 'SikkaFleet-GpsSync/2.0',
      };
      if (token) {
        headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
      }

      const response = await axios.get(apiUrl, {
        timeout: 15000,
        headers,
      });

      if (response.data && Array.isArray(response.data.vehicles)) {
        logRawTelemetrySample('Fleetx', response.data.vehicles);
        return { list: response.data.vehicles, status: `${response.status} OK` };
      }
      if (response.data && response.data.data && Array.isArray(response.data.data.vehicles)) {
        logRawTelemetrySample('Fleetx', response.data.data.vehicles);
        return { list: response.data.data.vehicles, status: `${response.status} OK` };
      }
      if (Array.isArray(response.data)) {
        logRawTelemetrySample('Fleetx', response.data);
        return { list: response.data, status: `${response.status} OK` };
      }

      throw new Error(`Unexpected payload structure from Fleetx API (status: ${response.status})`);
    } catch (err) {
      lastErr = err;
      console.warn(`[Fleetx API Attempt ${attempt} Failed]: ${redactSensitiveFields(err.message)}`);
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
    },
    rawEventId: String(item.dttimeInEpoch || item.createdDate || ''),
  };
}

/**
 * Normalizes Fleetx vehicle telemetry item into unified format.
 */
function normalizeFleetxItem(item) {
  const lat = parseTelemetryNumber(item.latitude);
  const lon = parseTelemetryNumber(item.longitude);
  const speed = parseTelemetryNumber(item.speed);
  const ignitionFromFields = [item.otherAttributes?.ignition, item.ignition]
    .map(parseTelemetryBoolean)
    .find((value) => value !== null);
  const statusFields = [item.status, item.otherAttributes?.actualStatus, item.currentStatus]
    .filter((value) => typeof value === 'string');
  const ignitionFromStatus = statusFields
    .map((value) => {
      if (/^ignition on$/i.test(value.trim())) return true;
      if (/^ignition off$/i.test(value.trim())) return false;
      return null;
    })
    .find((value) => value !== null);
  const isIgnitionOn = ignitionFromFields ?? ignitionFromStatus ?? null;
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
    driverName: item.driverName ? item.driverName.trim() : '',
    latitude: lat,
    longitude: lon,
    speed,
    ignition: isIgnitionOn,
    movementStatus,
    deviceNumber: item.deviceId || item.otherAttributes?.imei || '',
    vendorName: 'Fleetx',
    vehicleType: item.vehicleTypeValue || item.vehicleMake || null,
    angle: parseFloat(item.otherAttributes?.course) || 0,
    chargeOn: item.otherAttributes?.power === 'true',
    timestamp: parseTelematicsTimestamp(item),
    address: item.address || '',
    provider: 'Fleetx',
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

/**
 * Fetches and merges telemetry from all active GPS providers (WheelsEye and Fleetx).
 */
async function fetchAllGpsTelemetry(gpsSettings = []) {
  const weConfig = gpsSettings.find(
    (s) => s.provider && (s.provider.toLowerCase().includes('wheels') || (s.apiUrl && s.apiUrl.includes('wheelseye')))
  );
  const fxConfig = gpsSettings.find(
    (s) => s.provider && (s.provider.toLowerCase().includes('fleetx') || (s.apiUrl && s.apiUrl.includes('fleetx')))
  );

  let weUrl = weConfig?.apiUrl || DEFAULT_WHEELSEYE_URL;
  if (!weUrl || weUrl.includes('••••')) {
    weUrl = DEFAULT_WHEELSEYE_URL;
  }
  const weAuthFailed = weConfig?.connectionStatus === 'AUTH_FAILED';
  const weActive = weConfig ? weConfig.status === 'Active' && !weAuthFailed : true;
  const weToken = weConfig?.encryptedApiKey || process.env.WHEELSEYE_API_KEY || '';

  let fxUrl = fxConfig?.apiUrl || DEFAULT_FLEETX_URL;
  if (!fxUrl || fxUrl.includes('••••')) {
    fxUrl = DEFAULT_FLEETX_URL;
  }
  let fxToken = fxConfig?.encryptedApiKey || DEFAULT_FLEETX_TOKEN;
  if (!fxToken || fxToken.includes('••••')) {
    fxToken = DEFAULT_FLEETX_TOKEN;
  }
  const fxAuthFailed = fxConfig?.connectionStatus === 'AUTH_FAILED';
  const fxActive = fxConfig ? fxConfig.status === 'Active' && !fxAuthFailed : true;

  const fetchPromises = [];

  if (weAuthFailed) {
    fetchPromises.push(Promise.resolve({
      provider: 'WheelsEye GPS',
      status: 'AUTH_FAILED',
      items: [],
      error: new Error(weConfig.lastError || 'WheelsEye authentication failed. Update provider credentials to retry.'),
      authFailed: true,
      apiUrl: weUrl,
    }));
  }
  if (fxAuthFailed) {
    fetchPromises.push(Promise.resolve({
      provider: 'Fleetx',
      status: 'AUTH_FAILED',
      items: [],
      error: new Error(fxConfig.lastError || 'Fleetx authentication failed. Update provider credentials to retry.'),
      authFailed: true,
      apiUrl: fxUrl,
    }));
  }

  if (weActive && weUrl) {
    fetchPromises.push(
      fetchWheelseyeTelemetryWithRetries(weUrl, 3, weToken)
        .then((res) => ({
          provider: 'WheelsEye GPS',
          status: res.status,
          items: res.list.map(normalizeWheelseyeItem),
          error: null,
          authFailed: false,
          apiUrl: weUrl,
        }))
        .catch((err) => ({
          provider: 'WheelsEye GPS',
          status: err.response?.status === 401 || err.response?.status === 403
            ? 'AUTH_FAILED'
            : `ERROR: ${redactSensitiveFields(err.message)}`,
          items: [],
          error: new Error(redactSensitiveFields(err.message)),
          authFailed: err.response?.status === 401 || err.response?.status === 403,
          apiUrl: maskUrlSecret(weUrl),
        }))
    );
  }

  if (fxActive && fxUrl) {
    fetchPromises.push(
      fetchFleetxTelemetryWithRetries(fxUrl, fxToken, 3)
        .then((res) => ({
          provider: 'Fleetx',
          status: res.status,
          items: res.list.map(normalizeFleetxItem),
          error: null,
          authFailed: false,
          apiUrl: fxUrl,
          token: fxToken,
        }))
        .catch((err) => ({
          provider: 'Fleetx',
          status: err.response?.status === 401 || err.response?.status === 403
            ? 'AUTH_FAILED'
            : `ERROR: ${redactSensitiveFields(err.message)}`,
          items: [],
          error: new Error(redactSensitiveFields(err.message)),
          authFailed: err.response?.status === 401 || err.response?.status === 403,
          apiUrl: maskUrlSecret(fxUrl),
        }))
    );
  }

  const results = await Promise.all(fetchPromises);

  const providerStatuses = {};
  const vehicleMap = new Map();
  let anySuccess = false;
  let totalRawCount = 0;

  for (const r of results) {
    providerStatuses[r.provider] = {
      status: r.status,
      error: r.error ? r.error.message : null,
      count: r.items.length,
      authFailed: Boolean(r.authFailed),
      apiUrl: maskUrlSecret(r.apiUrl),
    };

    if (!r.error) {
      anySuccess = true;
      totalRawCount += r.items.length;
    }

    for (const item of r.items) {
      if (!item.vehicleNumber) continue;
      const cleanNum = item.vehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const existing = vehicleMap.get(cleanNum);

      if (!existing) {
        vehicleMap.set(cleanNum, item);
      } else {
        // If vehicle reported by multiple providers, prioritize the one with more recent timestamp
        const prevTime = existing.timestamp ? existing.timestamp.getTime() : 0;
        const curTime = item.timestamp ? item.timestamp.getTime() : 0;
        if (curTime > prevTime) {
          vehicleMap.set(cleanNum, item);
        }
      }
    }
  }

  if (!anySuccess) {
    const allErrors = results.map((r) => `${r.provider}: ${r.error?.message}`).join('; ');
    const error = new Error(results.length > 0
      ? `All GPS providers failed: ${allErrors}`
      : 'No active GPS provider is configured with a valid API URL.');
    error.providerStatuses = providerStatuses;
    throw error;
  }

  return {
    vehicles: Array.from(vehicleMap.values()),
    samples: results.flatMap((result) => result.items),
    providerStatuses,
    totalRawCount,
  };
}

/**
 * MAIN GPS SYNC PROCESSING SERVICE (Requirement 2)
 * Used by BOTH Automatic 30-min Background Scheduler and Manual "Sync GPS Now" button.
 *
 * Steps:
 * 1. Acquire Distributed DB Lock
 * 2. Load Active Vehicles and Active Plant Geofences
 * 3. Call Wheelseye API with 3 retries
 * 4. On API failure: Do NOT mark vehicles Outside, set gps_status to 'GPS SYNC FAILED', record error in log
 * 5. On API success:
 *    - Update vehicle location history without duplicates (checks vehicleId + gpsDateTime)
 *    - Evaluate Geofence: Inside DASNA Plant, Salt Plant, Tea Plant, or Outside
 *    - Update VehicleCurrentStatus table
 * 6. Update GpsSetting (last_evaluated_timestamp, next_scheduled_sync_at)
 * 7. Write to GpsSyncLog & CronExecutionLog
 * 8. Release Distributed Lock
 */
async function executeGpsSync({ source = 'AUTO', triggerType = 'GPS_AUTO_SYNC_30MIN', slotKey = null } = {}) {
  const syncId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();
  const isAuto = source === 'AUTO';

  // 1. Acquire Distributed Lock (Requirement 12)
  const lockAcquired = await acquireDistributedLock(`${source}_${triggerType}`);
  if (!lockAcquired) {
    console.log(`[GPS Sync] Skipped (${source}): Another sync job is currently running.`);
    return {
      success: true,
      inProgress: true,
      message: 'A GPS synchronization job is already in progress.',
    };
  }

  // Initial Log entries in DB (Requirement 11)
  let syncLogDoc = null;
  let cronLogDoc = null;
  try {
    if (slotKey && await GpsSyncLog.exists({ slotKey })) {
      return {
        success: true,
        skipped: true,
        message: `IST slot ${slotKey} was already evaluated.`,
      };
    }
    syncLogDoc = await GpsSyncLog.create({
      syncId,
      startedAt,
      source: isAuto ? 'AUTO' : 'GPS-AUTO',
      triggerType,
      ...(slotKey ? { slotKey } : {}),
      status: 'RUNNING',
    });
    cronLogDoc = await CronExecutionLog.create({
      jobName: 'Wheelseye GPS 30-Min Auto Sync',
      triggerType,
      status: 'RUNNING',
      startedAt,
    });
  } catch (logInitErr) {
    console.warn('[Log Creation Warning]:', logInitErr.message);
  }

  try {
    // 2. Resolve GPS API configurations
    const allSettings = await GpsSetting.find();

    // 3. Load Active Vehicles and Plants from database (Requirement 1)
    let activeVehicles = await Vehicle.find();
    const activePlants = await Plant.find({ status: 'Active' });

    const vehicleByNumber = new Map();
    for (const v of activeVehicles) {
      const clean = v.vehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
      vehicleByNumber.set(clean, v);
    }

    // 4. Call GPS APIs (WheelsEye & Fleetx) with retry logic
    let rawVehicles = [];
    let rawSamples = [];
    let apiStatus = '200 OK';
    let fetchError = null;
    let providerStatuses = {};

    try {
      const fetchResult = await fetchAllGpsTelemetry(allSettings);
      rawVehicles = fetchResult.vehicles;
      rawSamples = fetchResult.samples;
      providerStatuses = fetchResult.providerStatuses;
      apiStatus = Object.entries(providerStatuses)
        .map(([p, s]) => `${p}: ${s.status}`)
        .join(' | ');
    } catch (err) {
      fetchError = err;
      providerStatuses = err.providerStatuses || {};
      apiStatus = `ERROR: ${err.message}`;
    }

    const syncTime = new Date();

    // 5. API Failure Handling (Requirement 5 & 19):
    // DO NOT mark vehicles outside! DO NOT overwrite valid previous coordinates with null/zeros!
    if (fetchError) {
      console.error(`[GPS Sync API Failure] (${source}): ${fetchError.message}`);

      // Update vehicle status to show GPS SYNC FAILED without modifying geofence position
      for (const v of activeVehicles) {
        let curStatus = await VehicleCurrentStatus.findOne({ vehicleId: v._id });
        if (curStatus) {
          curStatus.gps_status = 'GPS STALE';
          curStatus.last_sync_source = isAuto ? 'AUTO' : 'GPS-AUTO';
          await curStatus.save();
        } else {
          curStatus = await VehicleCurrentStatus.create({
            vehicleId: v._id,
            vehicleNumber: v.vehicleNumber,
            latitude: null,
            longitude: null,
            gps_status: 'GPS STALE',
            last_sync_source: isAuto ? 'AUTO' : 'GPS-AUTO',
            status: 'Outside',
          });
        }
      }

      for (const [provider, providerStatus] of Object.entries(providerStatuses)) {
        await GpsSetting.findOneAndUpdate(
          { $or: [{ provider: new RegExp(provider.split(' ')[0], 'i') }, { apiUrl: new RegExp(provider.split(' ')[0], 'i') }] },
          {
            $set: {
              connectionStatus: providerStatus.authFailed ? 'AUTH_FAILED' : 'Connection Failed',
              last_sync_status: 'FAILED',
              lastError: providerStatus.error || fetchError.message,
            },
          }
        );
      }

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

      throw new Error(`GPS API request failed: ${fetchError.message}`);
    }

    // Persist every provider sample before selecting the newest point for current-state views.
    for (const item of rawSamples) {
      if (!item.vehicleNumber || !item.timestamp || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
        continue;
      }
      const cleanNumber = item.vehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const vehicle = vehicleByNumber.get(cleanNumber);
      if (!vehicle) continue;
      const normalizedNumber = normalizeVehicleNumber(vehicle.vehicleNumber);
      const rawSpeed = item.rawTelemetry && Object.prototype.hasOwnProperty.call(item.rawTelemetry, 'speed')
        ? item.rawTelemetry.speed
        : item.speed;
      const rawIgnition = item.rawTelemetry && Object.prototype.hasOwnProperty.call(item.rawTelemetry, 'ignition')
        ? item.rawTelemetry.ignition
        : item.ignition;
      await GpsHistory.updateOne(
        {
          vehicleNumberNormalized: normalizedNumber,
          provider: item.provider,
          gpsTimestamp: item.timestamp,
        },
        {
          $setOnInsert: {
            vehicleId: vehicle._id,
            vehicleNumber: vehicle.vehicleNumber,
            vehicleNumberNormalized: normalizedNumber,
            provider: item.provider,
            latitude: item.latitude,
            longitude: item.longitude,
            speed: rawSpeed ?? null,
            ignition: rawIgnition ?? null,
            gpsTimestamp: item.timestamp,
            syncTime,
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
    const seenVehicleIds = new Set();

    for (const item of rawVehicles) {
      if (!item.vehicleNumber) continue;
      const cleanNum = item.vehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
      let vehicle = vehicleByNumber.get(cleanNum);

      if (!vehicle) continue;

      seenVehicleIds.add(vehicle._id.toString());
      processedCount++;

      const lat = item.latitude;
      const lon = item.longitude;
      const hasCoordinates = typeof lat === 'number' && typeof lon === 'number' &&
        Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
      const deviceTimestamp = item.timestamp || null;
      if (!hasCoordinates || !deviceTimestamp) continue;
      const speed = item.speed;
      const ignition = item.ignition;
      const movementStatus = resolveMovementStatus({
        movementStatus: item.movementStatus,
        ignition,
        speed,
      });
      const address = item.address || (hasCoordinates ? getReadableLocation(lat, lon, activePlants) : '');

      // Geofence & Plant Status Calculation using SINGLE SOURCE OF TRUTH (geofenceService)
      let currentStatus = await VehicleCurrentStatus.findOne({ vehicleId: vehicle._id });
      if (
        currentStatus?.latest_gps_timestamp &&
        new Date(currentStatus.latest_gps_timestamp).getTime() > deviceTimestamp.getTime()
      ) {
        continue;
      }

      let entryDateTime = currentStatus ? currentStatus.lastEntryDateTime : null;
      let lastExitPlantName = currentStatus ? currentStatus.lastExitPlantName : null;
      let lastExitDateTime = currentStatus ? currentStatus.lastExitDateTime : null;

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
          sync_source: 'GPS-AUTO',
          rawEventId: String(item.rawEventId || ''),
          source: item.provider || 'WheelsEye GPS',
          provider: item.provider || 'WheelsEye GPS',
          vehicleNumberNormalized: normalizeVehicleNumber(vehicle.vehicleNumber),
        });
      }

      if (isInside) {
        const wasOutside = !currentStatus || currentStatus.status === 'Outside' || !currentStatus.currentPlantId;
        const changedPlant =
          currentStatus &&
          currentStatus.currentPlantId &&
          currentStatus.currentPlantId.toString() !== (plantId ? plantId.toString() : '');

        if (wasOutside || changedPlant) {
          entryDateTime = deviceTimestamp;
          if (entryDateTime && hasCoordinates) {
            await PlantEntry.create({
              vehicleId: vehicle._id,
              vehicleNumber: vehicle.vehicleNumber,
              plantId,
              plantName,
              entryDateTime,
              latitude: lat,
              longitude: lon,
              distanceMeter,
            });
            plantEntriesCount++;
            console.log(`[Plant Entry] ${vehicle.vehicleNumber} entered ${plantName} at ${entryDateTime.toISOString()}`);
          }
        } else if (!entryDateTime) {
          const lastEntry = await PlantEntry.findOne({ vehicleId: vehicle._id, plantId }).sort({ entryDateTime: -1 });
          entryDateTime = lastEntry ? lastEntry.entryDateTime : deviceTimestamp;
        }
      } else {
        // Transitioned to Outside: Record exit timestamp and plant name
        if (hasCoordinates && currentStatus && currentStatus.status === 'Inside' && currentStatus.currentPlantId) {
          const prevPlant = await Plant.findById(currentStatus.currentPlantId);
          lastExitPlantName = prevPlant ? prevPlant.plantName : currentStatus.current_plant;
          lastExitDateTime = deviceTimestamp;
        }
        entryDateTime = null;
      }

      // Calculate stay duration using real GPS timestamps (frozen if GPS STALE)
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
        latest_gps_timestamp: deviceTimestamp,
        last_successful_sync_at: syncTime,
        gps_status: gpsFreshness,
        last_sync_source: 'GPS-AUTO',
        stayHours,
        speed,
        ignition,
        speedRaw: item.rawTelemetry && Object.prototype.hasOwnProperty.call(item.rawTelemetry, 'speed')
          ? item.rawTelemetry.speed
          : null,
        ignitionRaw: item.rawTelemetry && Object.prototype.hasOwnProperty.call(item.rawTelemetry, 'ignition')
          ? item.rawTelemetry.ignition
          : null,
        movementStatus,
        provider: item.provider || null,
        rawTelemetry: item.rawTelemetry || null,
        address,
        lastEntryDateTime: entryDateTime,
        lastExitPlantName,
        lastExitDateTime,
        lastUpdatedAt: syncTime,
      };

      if (currentStatus) {
        Object.assign(currentStatus, updatePayload);
        await currentStatus.save();
      } else {
        await VehicleCurrentStatus.create({
          vehicleId: vehicle._id,
          ...updatePayload,
        });
      }

      updatedCount++;
    }

    for (const vehicle of activeVehicles) {
      await rebuildPlantStays(vehicle._id);
    }

    let reportsRebuilt = false;
    let reportRebuildError = null;
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

    // 7. Active vehicles not returned by any active GPS provider (Requirement 19)
    for (const v of activeVehicles) {
      if (!seenVehicleIds.has(v._id.toString())) {
        let curStatus = await VehicleCurrentStatus.findOne({ vehicleId: v._id });
        if (curStatus) {
          curStatus.gps_status = 'GPS STALE';
          curStatus.last_sync_source = 'GPS-AUTO';
          await curStatus.save();
        } else {
          curStatus = await VehicleCurrentStatus.create({
            vehicleId: v._id,
            vehicleNumber: v.vehicleNumber,
            latitude: null,
            longitude: null,
            gps_status: 'GPS DATA UNAVAILABLE',
            last_sync_source: 'GPS-AUTO',
            status: 'Outside',
          });
        }
      }
    }

    // 8. Automated Driver-to-Vehicle Assignment using GPS Proximity
    let assignmentStats = null;
    try {
      assignmentStats = await executeAutomatedDriverAssignment();
    } catch (assignmentErr) {
      console.error('[GPS Sync Driver Assignment Error]:', assignmentErr.message);
    }

    // 9. Next scheduled 30-minute slot in Asia/Kolkata (IST)
    const nextSlot = getNextFixed30MinSlotIST(syncTime);

    // 10. Update GpsSetting documents for both WheelsEye and Fleetx
    const weStatus = providerStatuses['WheelsEye GPS'];
    const fxStatus = providerStatuses['Fleetx'];

    const wheelseyeSettingUpdate = {
      provider: 'WheelsEye GPS',
      apiUrl: weStatus?.apiUrl || DEFAULT_WHEELSEYE_URL,
      connectionStatus: weStatus?.authFailed ? 'AUTH_FAILED' : weStatus?.error
        ? 'Connection Failed'
        : (weStatus ? 'Connected' : 'Pending'),
      next_scheduled_sync_at: nextSlot,
      reportsRebuilt,
      reportRebuildError,
      last_sync_source: 'GPS-AUTO',
      pollIntervalSeconds: 1800,
    };
    if (weStatus && !weStatus.error) {
      Object.assign(wheelseyeSettingUpdate, {
        lastSync: syncTime,
        last_evaluated_timestamp: syncTime,
        last_sync_status: 'SUCCESS',
        lastError: '',
        vehicles_processed: weStatus.count,
        vehicles_updated: weStatus.count,
      });
    } else if (weStatus?.error) {
      Object.assign(wheelseyeSettingUpdate, {
        last_sync_status: 'FAILED',
        lastError: weStatus.error,
      });
    }

    await GpsSetting.findOneAndUpdate(
      { $or: [{ provider: /wheels/i }, { apiUrl: /wheelseye/i }] },
      { $set: wheelseyeSettingUpdate },
      { upsert: true }
    );

    const fleetxSettingUpdate = {
      provider: 'Fleetx',
      apiUrl: fxStatus?.apiUrl || DEFAULT_FLEETX_URL,
      connectionStatus: fxStatus?.authFailed ? 'AUTH_FAILED' : fxStatus?.error
        ? 'Connection Failed'
        : (fxStatus ? 'Connected' : 'Pending'),
      next_scheduled_sync_at: nextSlot,
      last_sync_source: 'GPS-AUTO',
      pollIntervalSeconds: 1800,
    };
    if (fxStatus && !fxStatus.error) {
      Object.assign(fleetxSettingUpdate, {
        lastSync: syncTime,
        last_evaluated_timestamp: syncTime,
        last_sync_status: 'SUCCESS',
        lastError: '',
        vehicles_processed: fxStatus.count,
        vehicles_updated: fxStatus.count,
      });
    } else if (fxStatus?.error) {
      Object.assign(fleetxSettingUpdate, {
        last_sync_status: 'FAILED',
        lastError: fxStatus.error,
      });
    }

    await GpsSetting.findOneAndUpdate(
      { $or: [{ provider: /fleetx/i }, { apiUrl: /fleetx/i }] },
      { $set: fleetxSettingUpdate },
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
    };
  } finally {
    // Always release distributed lock
    await releaseDistributedLock();
  }
}

/**
 * Retrieves the comprehensive auto-sync state for dashboard and health inspection (Requirement 10).
 */
async function getAutoSyncStatus() {
  const settings = await GpsSetting.find();
  const setting = settings.find((s) => s.status === 'Active') || settings[0];
  const recentLog = await GpsSyncLog.findOne().sort({ startedAt: -1 });
  const recentSuccessfulLog = await GpsSyncLog.findOne({ status: 'SUCCESS' }).sort({ completedAt: -1 });
  const lock = await GpsSyncLock.findById(LOCK_ID);
  const lastSource = setting?.last_sync_source || recentLog?.source;

  const now = new Date();
  const nextScheduled = getNextFixed30MinSlotIST(now);

  const isLockActive = Boolean(lock && lock.isLocked && lock.expiresAt && lock.expiresAt > now);
  const activeProviders = settings.filter((s) => s.status === 'Active').map((s) => s.provider);
  const providerNames = activeProviders.length > 0 ? activeProviders.join(' & ') : (setting?.provider || 'WheelsEye GPS & Fleetx');

  return {
    auto_sync_enabled: settings.some((s) => s.status === 'Active'),
    interval_minutes: 30,
    timezone: 'Asia/Kolkata',
    last_sync_started_at: recentLog?.startedAt || setting?.lastSync || null,
    last_sync_completed_at: recentLog?.completedAt || setting?.lastSync || null,
    last_successful_sync_at: recentSuccessfulLog?.lastEvaluatedTimestamp || null,
    next_scheduled_sync_at: nextScheduled,
    last_sync_status: recentLog?.status || setting?.last_sync_status || 'IDLE',
    last_sync_source: lastSource === 'AUTO' ? 'AUTO' : lastSource ? 'GPS-AUTO' : 'AUTO',
    vehicles_processed: setting?.vehicles_processed ?? recentLog?.vehiclesProcessed ?? 0,
    vehicles_updated: setting?.vehicles_updated ?? recentLog?.vehiclesUpdated ?? 0,
    vehicles_failed: setting?.vehicles_failed ?? recentLog?.vehiclesFailed ?? 0,
    is_syncing: isLockActive,
    provider: providerNames,
    connection_status: settings.some((s) => s.connectionStatus === 'Connected') ? 'Connected' : (setting?.connectionStatus || 'Pending'),
    last_error: settings.find((s) => s.lastError)?.lastError || '',
  };
}

module.exports = {
  executeGpsSync,
  getAutoSyncStatus,
  getNextFixed30MinSlotIST,
  acquireDistributedLock,
  releaseDistributedLock,
  DEFAULT_WHEELSEYE_URL,
  DEFAULT_FLEETX_URL,
  DEFAULT_FLEETX_TOKEN,
  fetchAllGpsTelemetry,
  fetchWheelseyeTelemetryWithRetries,
  fetchFleetxTelemetryWithRetries,
  parseTelematicsTimestamp,
  normalizeWheelseyeItem,
  normalizeFleetxItem,
};
