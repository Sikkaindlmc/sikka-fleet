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

const DEFAULT_WHEELSEYE_URL =
  process.env.WHEELSEYE_API_URL ||
  'https://api.wheelseye.com/currentLoc?accessToken=53afc208-0981-48c7-b134-d85d2f33dc0c';

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
 * Parses Wheelseye timestamp from epoch seconds, milliseconds, or date string.
 */
function parseWheelseyeTimestamp(item) {
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
    // 2. Resolve GPS API configuration
    let config = await GpsSetting.findOne().sort({ updatedAt: -1 });
    const apiUrl =
      config?.apiUrl && config.apiUrl.includes('wheelseye') ? config.apiUrl : DEFAULT_WHEELSEYE_URL;

    // 3. Load Active Vehicles and Plants from database (Requirement 1)
    const activeVehicles = await Vehicle.find({ status: 'Active' });
    const activePlants = await Plant.find({ status: 'Active' });

    const vehicleByNumber = new Map();
    for (const v of activeVehicles) {
      const clean = v.vehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
      vehicleByNumber.set(clean, v);
    }

    // 4. Call Wheelseye GPS API with retry logic (Requirement 4)
    let rawVehicles = [];
    let apiStatus = '200 OK';
    let fetchError = null;

    try {
      const fetchResult = await fetchWheelseyeTelemetryWithRetries(apiUrl, 3);
      rawVehicles = fetchResult.list;
      apiStatus = fetchResult.status;
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

      if (config) {
        config.connectionStatus = 'Connection Failed';
        config.last_sync_status = 'FAILED';
        config.lastError = fetchError.message;
        await config.save();
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

      throw new Error(`Wheelseye GPS API request failed: ${fetchError.message}`);
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
      const vehicle = vehicleByNumber.get(cleanNum);

      if (!vehicle) continue; // Skip vehicles not registered in active fleet
      seenVehicleIds.add(vehicle._id.toString());
      processedCount++;

      const lat = typeof item.latitude === 'number' ? item.latitude : parseFloat(item.latitude);
      const lon = typeof item.longitude === 'number' ? item.longitude : parseFloat(item.longitude);

      if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) {
        failedCount++;
        continue;
      }

      const deviceTimestamp = parseWheelseyeTimestamp(item);
      const speed = Number(item.speed) || 0;
      const ignition = Boolean(item.ignition);
      const address = getReadableLocation(lat, lon, activePlants);

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
          rawEventId: String(item.dttimeInEpoch || item.createdDate || ''),
          source: 'WheelsEye GPS',
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

    // 7. Active vehicles not returned by Wheelseye (Requirement 19)
    // Mark as GPS DATA UNAVAILABLE or GPS STALE without moving to Outside
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

    // 8. Next scheduled 30-minute slot in Asia/Kolkata (IST)
    const nextSlot = getNextFixed30MinSlotIST(syncTime);

    // 9. Update GpsSetting with official status
    if (!config) {
      config = await GpsSetting.create({
        provider: 'WheelsEye GPS',
        apiUrl,
        status: 'Active',
        connectionStatus: 'Connected',
        lastSync: syncTime,
        last_evaluated_timestamp: syncTime,
        last_sync_status: 'SUCCESS',
        next_scheduled_sync_at: nextSlot,
        last_sync_source: isAuto ? 'AUTO' : 'MANUAL',
        vehicles_processed: processedCount,
        vehicles_updated: updatedCount,
        vehicles_failed: failedCount,
        pollIntervalSeconds: 1800,
      });
    } else {
      config.lastSync = syncTime;
      config.last_evaluated_timestamp = syncTime;
      config.last_sync_status = 'SUCCESS';
      config.next_scheduled_sync_at = nextSlot;
      config.last_sync_source = isAuto ? 'AUTO' : 'MANUAL';
      config.vehicles_processed = processedCount;
      config.vehicles_updated = updatedCount;
      config.vehicles_failed = failedCount;
      config.connectionStatus = 'Connected';
      config.lastError = '';
      config.pollIntervalSeconds = 1800;
      await config.save();
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // 10. Update Sync Logs (Requirement 11)
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
      `[GPS Sync SUCCESS] [${istTimeString}] Source: ${source}. Processed: ${processedCount}, Updated: ${updatedCount}, Duration: ${durationMs}ms.`
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
  const setting = await GpsSetting.findOne().sort({ updatedAt: -1 });
  const recentLog = await GpsSyncLog.findOne().sort({ startedAt: -1 });
  const lock = await GpsSyncLock.findById(LOCK_ID);

  const now = new Date();
  const nextScheduled = setting?.next_scheduled_sync_at || getNextFixed30MinSlotIST(now);

  const isLockActive = Boolean(lock && lock.isLocked && lock.expiresAt && lock.expiresAt > now);

  return {
    auto_sync_enabled: setting ? setting.status === 'Active' : true,
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
    provider: setting?.provider || 'WheelsEye GPS',
    connection_status: setting?.connectionStatus || 'Connected',
    last_error: setting?.lastError || '',
  };
}

module.exports = {
  executeGpsSync,
  getAutoSyncStatus,
  getNextFixed30MinSlotIST,
  acquireDistributedLock,
  releaseDistributedLock,
  DEFAULT_WHEELSEYE_URL,
};
