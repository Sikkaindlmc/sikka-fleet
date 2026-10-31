const axios = require('axios');
const { v4: uuidv4 } = require('crypto'); // Built-in crypto in Node
const Vehicle = require('../models/Vehicle');
const Plant = require('../models/Plant');
const GpsSetting = require('../models/GpsSetting');
const VehicleLocation = require('../models/VehicleLocation');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const PlantEntry = require('../models/PlantEntry');
const GpsSyncLock = require('../models/GpsSyncLock');
const GpsSyncLog = require('../models/GpsSyncLog');
const CronExecutionLog = require('../models/CronExecutionLog');
const { calculateHaversineDistance } = require('./geofenceService');
const { getReadableLocation } = require('./locationHelper');
const { isSafeExternalUrl } = require('../utils/security');
const { executeAutomatedDriverAssignment } = require('./driverMatchingService');

const DEFAULT_WHEELSEYE_URL =
  process.env.WHEELSEYE_API_URL ||
  'https://api.wheelseye.com/currentLoc?accessToken=53afc208-0981-48c7-b134-d85d2f33dc0c';

const DEFAULT_FLEETX_URL =
  process.env.FLEETX_API_URL ||
  'https://api.fleetx.io/api/v1/analytics/live';

const DEFAULT_FLEETX_TOKEN =
  process.env.FLEETX_API_KEY ||
  process.env.FLEETX_BEARER_TOKEN ||
  '75683dcb-9df0-429c-b3a2-646542ac50e5';

const LOCK_ID = 'gps_sync_lock';
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes safety timeout
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes = GPS Stale

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
  if (item.lastUpdatedAt !== undefined && item.lastUpdatedAt !== null) {
    const num = Number(item.lastUpdatedAt);
    if (!isNaN(num) && num > 0) {
      const ms = num > 1e11 ? num : num * 1000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d;
    }
  }
  if (item.lastStatusTime !== undefined && item.lastStatusTime !== null) {
    const num = Number(item.lastStatusTime);
    if (!isNaN(num) && num > 0) {
      const ms = num > 1e11 ? num : num * 1000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d;
    }
  }
  if (item.otherAttributes?.serverTime) {
    const num = Number(item.otherAttributes.serverTime);
    if (!isNaN(num) && num > 0) {
      const ms = num > 1e11 ? num : num * 1000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d;
    }
  }
  if (item.createdDate !== undefined && item.createdDate !== null) {
    const num = Number(item.createdDate);
    if (!isNaN(num) && num > 0) {
      const ms = num > 1e11 ? num : num * 1000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d;
    }
  }
  if (item.dttimeInEpoch !== undefined && item.dttimeInEpoch !== null) {
    const num = Number(item.dttimeInEpoch);
    if (!isNaN(num) && num > 0) {
      const ms = num > 1e11 ? num : num * 1000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d;
    }
  }
  if (item.dttime) {
    const d = new Date(item.dttime);
    if (!isNaN(d.getTime())) return d;
  }
  if (item.createdDateReadable) {
    const d = new Date(item.createdDateReadable);
    if (!isNaN(d.getTime())) return d;
  }
  if (item.timestamp) {
    const d = new Date(item.timestamp);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
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
async function fetchWheelseyeTelemetryWithRetries(apiUrl, maxAttempts = 3) {
  if (!apiUrl || !isSafeExternalUrl(apiUrl)) {
    throw new Error('Refusing to query unsafe or invalid GPS API URL.');
  }

  let lastErr = null;
  const backoffDelays = [0, 2000, 4000];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const delay = backoffDelays[attempt - 1] || 2000;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      console.log(`[Wheelseye API] Attempt ${attempt}/${maxAttempts} requesting ${apiUrl.replace(/accessToken=[^&]+/, 'accessToken=***')}...`);
      const response = await axios.get(apiUrl, {
        timeout: 15000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SikkaFleet-GpsSync/2.0',
        },
      });

      if (response.data && response.data.data && Array.isArray(response.data.data.list)) {
        return { list: response.data.data.list, status: `${response.status} OK` };
      }
      if (response.data && Array.isArray(response.data.list)) {
        return { list: response.data.list, status: `${response.status} OK` };
      }
      if (Array.isArray(response.data)) {
        return { list: response.data, status: `${response.status} OK` };
      }

      throw new Error(`Unexpected payload structure from Wheelseye API (status: ${response.status})`);
    } catch (err) {
      lastErr = err;
      console.warn(`[Wheelseye API Attempt ${attempt} Failed]: ${err.message}`);
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
  const backoffDelays = [0, 2000, 4000];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const delay = backoffDelays[attempt - 1] || 2000;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      console.log(`[Fleetx API] Attempt ${attempt}/${maxAttempts} requesting ${apiUrl}...`);
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
        return { list: response.data.vehicles, status: `${response.status} OK` };
      }
      if (response.data && response.data.data && Array.isArray(response.data.data.vehicles)) {
        return { list: response.data.data.vehicles, status: `${response.status} OK` };
      }
      if (Array.isArray(response.data)) {
        return { list: response.data, status: `${response.status} OK` };
      }

      throw new Error(`Unexpected payload structure from Fleetx API (status: ${response.status})`);
    } catch (err) {
      lastErr = err;
      console.warn(`[Fleetx API Attempt ${attempt} Failed]: ${err.message}`);
    }
  }

  throw lastErr;
}

/**
 * Normalizes WheelsEye vehicle telemetry item into unified format.
 */
function normalizeWheelseyeItem(item) {
  const lat = typeof item.latitude === 'number' ? item.latitude : parseFloat(item.latitude);
  const lon = typeof item.longitude === 'number' ? item.longitude : parseFloat(item.longitude);
  const speed = Number(item.speed) || 0;
  const isIgnitionOn = Boolean(item.ignition);

  return {
    vehicleNumber: item.vehicleNumber?.trim().toUpperCase(),
    driverName: item.driverName || '',
    latitude: lat,
    longitude: lon,
    speed,
    ignition: isIgnitionOn,
    deviceNumber: item.deviceNumber || '',
    vendorName: item.venndorName || item.vendorName || 'Vaibhav Sikka',
    vehicleType: item.vehicleType || 'Commercial',
    angle: item.angle || 0,
    chargeOn: Boolean(item.chargeOn),
    timestamp: parseTelematicsTimestamp(item),
    address: '',
    provider: 'WheelsEye GPS',
    rawEventId: String(item.dttimeInEpoch || item.createdDate || ''),
  };
}

/**
 * Normalizes Fleetx vehicle telemetry item into unified format.
 */
function normalizeFleetxItem(item) {
  const lat = typeof item.latitude === 'number' ? item.latitude : parseFloat(item.latitude);
  const lon = typeof item.longitude === 'number' ? item.longitude : parseFloat(item.longitude);
  const speed = Number(item.speed) || 0;
  const isIgnitionOn =
    item.otherAttributes?.ignition === 'true' ||
    item.status === 'Ignition On' ||
    item.otherAttributes?.actualStatus === 'Ignition On' ||
    item.currentStatus === 'RUNNING';

  return {
    vehicleNumber: item.vehicleNumber?.trim().toUpperCase(),
    driverName: item.driverName ? item.driverName.trim() : '',
    latitude: lat,
    longitude: lon,
    speed,
    ignition: isIgnitionOn,
    deviceNumber: item.deviceId || item.otherAttributes?.imei || '',
    vendorName: 'Fleetx',
    vehicleType: item.vehicleTypeValue || item.vehicleMake || 'Truck',
    angle: parseFloat(item.otherAttributes?.course) || 0,
    chargeOn: item.otherAttributes?.power === 'true',
    timestamp: parseTelematicsTimestamp(item),
    address: item.address || '',
    provider: 'Fleetx',
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

  const weUrl = weConfig?.apiUrl || DEFAULT_WHEELSEYE_URL;
  const weActive = weConfig ? weConfig.status === 'Active' : true;

  const fxUrl = fxConfig?.apiUrl || DEFAULT_FLEETX_URL;
  const fxToken = fxConfig?.encryptedApiKey || DEFAULT_FLEETX_TOKEN;
  const fxActive = fxConfig ? fxConfig.status === 'Active' : true;

  const fetchPromises = [];

  if (weActive && weUrl) {
    fetchPromises.push(
      fetchWheelseyeTelemetryWithRetries(weUrl, 3)
        .then((res) => ({
          provider: 'WheelsEye GPS',
          status: res.status,
          items: res.list.map(normalizeWheelseyeItem),
          error: null,
          apiUrl: weUrl,
        }))
        .catch((err) => ({
          provider: 'WheelsEye GPS',
          status: `ERROR: ${err.message}`,
          items: [],
          error: err,
          apiUrl: weUrl,
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
          apiUrl: fxUrl,
          token: fxToken,
        }))
        .catch((err) => ({
          provider: 'Fleetx',
          status: `ERROR: ${err.message}`,
          items: [],
          error: err,
          apiUrl: fxUrl,
          token: fxToken,
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
      apiUrl: r.apiUrl,
      token: r.token,
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

  if (!anySuccess && results.length > 0) {
    const allErrors = results.map((r) => `${r.provider}: ${r.error?.message}`).join('; ');
    throw new Error(`All GPS providers failed: ${allErrors}`);
  }

  return {
    vehicles: Array.from(vehicleMap.values()),
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
async function executeGpsSync({ source = 'AUTO', triggerType = 'GPS_AUTO_SYNC_30MIN' } = {}) {
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
    syncLogDoc = await GpsSyncLog.create({
      syncId,
      startedAt,
      source: isAuto ? 'AUTO' : 'MANUAL',
      triggerType,
      status: 'RUNNING',
    });
    cronLogDoc = await CronExecutionLog.create({
      jobName: 'Wheelseye GPS 30-Min Auto Sync',
      triggerType: isAuto ? triggerType : `Manual (${triggerType})`,
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
    let activeVehicles = await Vehicle.find({ status: 'Active' });
    const activePlants = await Plant.find({ status: 'Active' });

    const vehicleByNumber = new Map();
    for (const v of activeVehicles) {
      const clean = v.vehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
      vehicleByNumber.set(clean, v);
    }

    // 4. Call GPS APIs (WheelsEye & Fleetx) with retry logic
    let rawVehicles = [];
    let apiStatus = '200 OK';
    let fetchError = null;
    let providerStatuses = {};

    try {
      const fetchResult = await fetchAllGpsTelemetry(allSettings);
      rawVehicles = fetchResult.vehicles;
      providerStatuses = fetchResult.providerStatuses;
      apiStatus = Object.entries(providerStatuses)
        .map(([p, s]) => `${p}: ${s.status}`)
        .join(' | ');
    } catch (err) {
      fetchError = err;
      apiStatus = `ERROR: ${err.message}`;
    }

    const syncTime = new Date();

    // 5. API Failure Handling (Requirement 5 & 19):
    // DO NOT mark vehicles outside! DO NOT overwrite valid previous coordinates with null/zeros!
    if (fetchError) {
      console.error(`[GPS Sync API Failure] (${source}): ${fetchError.message}`);

      // Update vehicle status to show GPS SYNC FAILED without modifying geofence position
      for (const v of activeVehicles) {
        const curStatus = await VehicleCurrentStatus.findOne({ vehicleId: v._id });
        if (curStatus) {
          curStatus.gps_status = 'GPS SYNC FAILED';
          curStatus.last_sync_source = isAuto ? 'AUTO' : 'MANUAL';
          await curStatus.save();
        }
      }

      await GpsSetting.updateMany(
        {},
        {
          $set: {
            connectionStatus: 'Connection Failed',
            last_sync_status: 'FAILED',
            lastError: fetchError.message,
          },
        }
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

      throw new Error(`GPS API request failed: ${fetchError.message}`);
    }

    // 6. Process Received Telemetry for Each Active Vehicle
    let processedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    let plantEntriesCount = 0;
    const seenVehicleIds = new Set();

    for (const item of rawVehicles) {
      if (!item.vehicleNumber) continue;
      const cleanNum = item.vehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
      let vehicle = vehicleByNumber.get(cleanNum);

      // Check if vehicle exists in database (even if Inactive) or create new one
      if (!vehicle) {
        vehicle = await Vehicle.findOne({ vehicleNumber: item.vehicleNumber.trim().toUpperCase() });
        if (vehicle) {
          vehicleByNumber.set(cleanNum, vehicle);
        } else {
          // Truly new vehicle from authorized telemetry provider (e.g. Fleetx or WheelsEye)
          try {
            vehicle = await Vehicle.create({
              vehicleNumber: item.vehicleNumber.trim().toUpperCase(),
              driverName: item.driverName ? item.driverName.trim() : '',
              mobile: '',
              fleetType: 'Own Fleet',
              ownerName: '',
              gpsDeviceId: item.deviceNumber || item.vehicleNumber.trim().toUpperCase(),
              status: 'Active',
            });
            vehicleByNumber.set(cleanNum, vehicle);
            activeVehicles.push(vehicle);
            console.log(`[GPS Sync] Auto-registered new fleet vehicle from ${item.provider}: ${vehicle.vehicleNumber}`);
          } catch (vehCreateErr) {
            console.warn(`[GPS Sync Auto-Register Warning] Could not register ${item.vehicleNumber}: ${vehCreateErr.message}`);
            continue;
          }
        }
      }

      // If vehicle is marked Inactive by administrator, skip location tracking
      if (vehicle.status === 'Inactive') {
        continue;
      }

      seenVehicleIds.add(vehicle._id.toString());
      processedCount++;

      const lat = typeof item.latitude === 'number' ? item.latitude : parseFloat(item.latitude);
      const lon = typeof item.longitude === 'number' ? item.longitude : parseFloat(item.longitude);

      if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) {
        failedCount++;
        continue;
      }

      const deviceTimestamp = item.timestamp || syncTime;
      const speed = Number(item.speed) || 0;
      const ignition = Boolean(item.ignition);
      const address = item.address || getReadableLocation(lat, lon, activePlants);

      // Geofence Calculation (Requirement 6)
      // Check DASNA Plant, Salt Plant, Tea Plant, etc.
      let matchedPlant = null;
      let minDistance = Infinity;

      for (const plant of activePlants) {
        const radius = plant.radiusMeters || plant.radiusMeter || 500;
        const dist = calculateHaversineDistance(lat, lon, plant.latitude, plant.longitude);
        if (dist <= radius) {
          if (dist < minDistance) {
            minDistance = dist;
            matchedPlant = plant;
          }
        }
      }

      const isInside = matchedPlant !== null;
      const geofenceStatus = isInside ? 'INSIDE' : 'OUTSIDE';
      const plantId = matchedPlant ? matchedPlant._id : null;
      const plantName = matchedPlant ? matchedPlant.plantName : '';
      const distanceMeter = isInside ? minDistance : null;

      // Deduplication Guard (Requirement 2):
      // Check whether this exact vehicleId + gpsDateTime is already recorded.
      const existingLocation = await VehicleLocation.findOne({
        vehicleId: vehicle._id,
        gpsDateTime: deviceTimestamp,
      });

      if (!existingLocation) {
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
          address,
          geofence_status: geofenceStatus,
          plant_id: plantId,
          plantName,
          sync_source: isAuto ? 'AUTO' : 'MANUAL',
          rawEventId: String(item.rawEventId || ''),
          source: item.provider || 'WheelsEye GPS',
        });
      }

      // GPS Freshness calculation (Requirement 18, 19)
      const ageMs = syncTime.getTime() - deviceTimestamp.getTime();
      let gpsFreshness = 'LIVE';
      if (ageMs > STALE_THRESHOLD_MS) {
        gpsFreshness = 'GPS STALE';
      } else if (ageMs > 15 * 60 * 1000) {
        gpsFreshness = 'RECENT';
      }

      // Update VehicleCurrentStatus table (Requirement 7)
      let currentStatus = await VehicleCurrentStatus.findOne({ vehicleId: vehicle._id });

      let entryDateTime = currentStatus ? currentStatus.lastEntryDateTime : null;
      let lastExitPlantName = currentStatus ? currentStatus.lastExitPlantName : null;
      let lastExitDateTime = currentStatus ? currentStatus.lastExitDateTime : null;

      if (isInside) {
        const wasOutside = !currentStatus || currentStatus.status === 'Outside' || !currentStatus.currentPlantId;
        const changedPlant =
          currentStatus &&
          currentStatus.currentPlantId &&
          currentStatus.currentPlantId.toString() !== plantId.toString();

        if (wasOutside || changedPlant) {
          entryDateTime = deviceTimestamp || syncTime;
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
        } else if (!entryDateTime) {
          const lastEntry = await PlantEntry.findOne({ vehicleId: vehicle._id, plantId }).sort({ entryDateTime: -1 });
          entryDateTime = lastEntry ? lastEntry.entryDateTime : (deviceTimestamp || syncTime);
        }
      } else {
        // Transitioned to Outside: Record exit timestamp and plant name
        if (currentStatus && currentStatus.status === 'Inside' && currentStatus.currentPlantId) {
          const prevPlant = await Plant.findById(currentStatus.currentPlantId);
          lastExitPlantName = prevPlant ? prevPlant.plantName : currentStatus.current_plant;
          lastExitDateTime = syncTime;
        }
        entryDateTime = null;
      }

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
        last_sync_source: isAuto ? 'AUTO' : 'MANUAL',
        speed,
        ignition,
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

    // 7. Active vehicles not returned by any active GPS provider (Requirement 19)
    for (const v of activeVehicles) {
      if (!seenVehicleIds.has(v._id.toString())) {
        const curStatus = await VehicleCurrentStatus.findOne({ vehicleId: v._id });
        if (curStatus) {
          curStatus.gps_status = 'GPS DATA UNAVAILABLE';
          curStatus.last_sync_source = isAuto ? 'AUTO' : 'MANUAL';
          await curStatus.save();
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

    await GpsSetting.findOneAndUpdate(
      { $or: [{ provider: /wheels/i }, { apiUrl: /wheelseye/i }] },
      {
        $set: {
          provider: 'WheelsEye GPS',
          apiUrl: weStatus?.apiUrl || DEFAULT_WHEELSEYE_URL,
          status: 'Active',
          connectionStatus: weStatus?.error ? 'Connection Failed' : 'Connected',
          lastSync: syncTime,
          last_evaluated_timestamp: syncTime,
          last_sync_status: weStatus?.error ? 'FAILED' : 'SUCCESS',
          lastError: weStatus?.error || '',
          next_scheduled_sync_at: nextSlot,
          last_sync_source: isAuto ? 'AUTO' : 'MANUAL',
          vehicles_processed: weStatus?.count || 0,
          vehicles_updated: weStatus?.count || 0,
          pollIntervalSeconds: 1800,
        },
      },
      { upsert: true }
    );

    await GpsSetting.findOneAndUpdate(
      { $or: [{ provider: /fleetx/i }, { apiUrl: /fleetx/i }] },
      {
        $set: {
          provider: 'Fleetx',
          apiUrl: fxStatus?.apiUrl || DEFAULT_FLEETX_URL,
          encryptedApiKey: fxStatus?.token || DEFAULT_FLEETX_TOKEN,
          status: 'Active',
          connectionStatus: fxStatus?.error ? 'Connection Failed' : 'Connected',
          lastSync: syncTime,
          last_evaluated_timestamp: syncTime,
          last_sync_status: fxStatus?.error ? 'FAILED' : 'SUCCESS',
          lastError: fxStatus?.error || '',
          next_scheduled_sync_at: nextSlot,
          last_sync_source: isAuto ? 'AUTO' : 'MANUAL',
          vehicles_processed: fxStatus?.count || 0,
          vehicles_updated: fxStatus?.count || 0,
          pollIntervalSeconds: 1800,
        },
      },
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
  const lock = await GpsSyncLock.findById(LOCK_ID);

  const now = new Date();
  const nextScheduled = setting?.next_scheduled_sync_at || getNextFixed30MinSlotIST(now);

  const isLockActive = Boolean(lock && lock.isLocked && lock.expiresAt && lock.expiresAt > now);
  const activeProviders = settings.filter((s) => s.status === 'Active').map((s) => s.provider);
  const providerNames = activeProviders.length > 0 ? activeProviders.join(' & ') : (setting?.provider || 'WheelsEye GPS & Fleetx');

  return {
    auto_sync_enabled: settings.some((s) => s.status === 'Active'),
    interval_minutes: 30,
    timezone: 'Asia/Kolkata',
    last_sync_started_at: recentLog?.startedAt || setting?.lastSync || null,
    last_sync_completed_at: recentLog?.completedAt || setting?.lastSync || null,
    last_successful_sync_at: setting?.last_evaluated_timestamp || setting?.lastSync || null,
    next_scheduled_sync_at: nextScheduled,
    last_sync_status: setting?.last_sync_status || recentLog?.status || 'IDLE',
    last_sync_source: setting?.last_sync_source || recentLog?.source || 'AUTO',
    vehicles_processed: setting?.vehicles_processed ?? recentLog?.vehiclesProcessed ?? 0,
    vehicles_updated: setting?.vehicles_updated ?? recentLog?.vehiclesUpdated ?? 0,
    vehicles_failed: setting?.vehicles_failed ?? recentLog?.vehiclesFailed ?? 0,
    is_syncing: isLockActive,
    provider: providerNames,
    connection_status: settings.some((s) => s.connectionStatus === 'Connected') ? 'Connected' : (setting?.connectionStatus || 'Connected'),
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
};
