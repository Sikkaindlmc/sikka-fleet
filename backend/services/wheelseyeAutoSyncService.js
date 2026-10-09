const axios = require('axios');
const Vehicle = require('../models/Vehicle');
const Plant = require('../models/Plant');
const GpsSetting = require('../models/GpsSetting');
const CronExecutionLog = require('../models/CronExecutionLog');
const { processVehicleLocation } = require('./geofenceService');

const DEFAULT_WHEELSEYE_URL =
  process.env.WHEELSEYE_API_URL ||
  'https://api.wheelseye.com/currentLoc?accessToken=53afc208-0981-48c7-b134-d85d2f33dc0c';

let isSyncRunning = false;

/**
 * Parses Wheelseye timestamp from epoch seconds, milliseconds, or ISO string.
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
  if (item.dttimeInEpoch) {
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
  if (item.timestamp) {
    const d = new Date(item.timestamp);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * Calculates next fixed 30-min IST boundary (HH:00 or HH:30).
 */
function getNextFixed30MinSlot(date = new Date()) {
  const d = new Date(date);
  const minutes = d.getMinutes();
  const target = new Date(d);

  if (minutes < 30) {
    target.setMinutes(30, 0, 0);
  } else {
    target.setHours(target.getHours() + 1, 0, 0, 0);
  }

  if (target.getTime() <= d.getTime()) {
    target.setMinutes(target.getMinutes() + 30, 0, 0);
  }
  return target;
}

/**
 * Fetches Wheelseye API data with timeout and retry guard.
 */
async function fetchWheelseyeTelemetry(apiUrl, retries = 2) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const response = await axios.get(apiUrl, {
        timeout: 15000, // 15s timeout guard
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SikkaFleet-AutoSync/1.0',
        },
      });

      if (response.data && response.data.data && Array.isArray(response.data.data.list)) {
        return response.data.data.list;
      }
      if (response.data && Array.isArray(response.data.list)) {
        return response.data.list;
      }
      if (Array.isArray(response.data)) {
        return response.data;
      }

      throw new Error('Unexpected Wheelseye API payload structure.');
    } catch (err) {
      lastErr = err;
      console.warn(`[Wheelseye Telemetry Attempt ${attempt} Failed]: ${err.message}`);
      if (attempt <= retries) {
        // Wait 1.5s before retry
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }
  throw lastErr;
}

/**
 * Core Auto-Sync Engine:
 * 1. Fetches live vehicle coordinates from Wheelseye API.
 * 2. Compares coordinates against Plant Geofences (Dasna Plant, Salt Plant, Tea Plant, etc.).
 * 3. Detects vehicle entries/exits and writes actual entry/exit timestamps to DB.
 * 4. Updates system last_evaluated_timestamp in GpsSetting.
 * 5. Logs execution history in cron_execution_logs table.
 */
async function executeWheelseyeAutoSync(triggerType = 'CRON_WORKER_IST') {
  if (isSyncRunning) {
    console.log(`[Wheelseye Auto-Sync] Skipped: another sync cycle is currently in progress.`);
    return { success: true, message: 'Sync cycle already in progress', inProgress: true };
  }

  isSyncRunning = true;
  const startedAt = new Date();

  // Create initial log in DB
  let logRecord = null;
  try {
    logRecord = await CronExecutionLog.create({
      jobName: 'Wheelseye GPS 30-Min Auto Sync',
      triggerType,
      status: 'RUNNING',
      startedAt,
    });
  } catch (logErr) {
    console.error('[CronExecutionLog Create Error]:', logErr.message);
  }

  try {
    // 1. Resolve GPS Setting and API URL
    let config = await GpsSetting.findOne().sort({ updatedAt: -1 });
    let apiUrl = config?.apiUrl && config.apiUrl.includes('wheelseye') ? config.apiUrl : DEFAULT_WHEELSEYE_URL;

    // 2. Fetch live vehicle points from Wheelseye
    const rawVehicles = await fetchWheelseyeTelemetry(apiUrl);
    const syncTime = new Date();

    // 3. Query active registered fleet vehicles
    const activeVehicles = await Vehicle.find({ status: 'Active' });
    const vehicleByNumber = new Map();
    for (const v of activeVehicles) {
      vehicleByNumber.set(v.vehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, ''), v);
    }

    let processedCount = 0;
    let entriesCount = 0;

    // 4. Process each live Wheelseye vehicle point
    for (const item of rawVehicles) {
      if (!item.vehicleNumber) continue;
      const cleanNum = item.vehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const vehicle = vehicleByNumber.get(cleanNum);

      if (vehicle && typeof item.latitude === 'number' && typeof item.longitude === 'number') {
        const deviceTimestamp = parseWheelseyeTimestamp(item);

        const result = await processVehicleLocation(
          vehicle,
          item.latitude,
          item.longitude,
          deviceTimestamp,
          'WheelsEye GPS',
          syncTime
        );

        if (result && result.entryEventRecorded) {
          entriesCount++;
        }
        processedCount++;
      }
    }

    // 5. Update GpsSetting with official last_evaluated_timestamp
    if (!config) {
      config = await GpsSetting.create({
        provider: 'WheelsEye GPS',
        apiUrl,
        status: 'Active',
        connectionStatus: 'Connected',
        lastSync: syncTime,
        last_evaluated_timestamp: syncTime,
        pollIntervalSeconds: 1800,
      });
    } else {
      config.lastSync = syncTime;
      config.last_evaluated_timestamp = syncTime;
      config.connectionStatus = 'Connected';
      config.lastError = '';
      config.pollIntervalSeconds = 1800;
      await config.save();
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // 6. Complete CronExecutionLog entry
    if (logRecord) {
      logRecord.status = 'SUCCESS';
      logRecord.completedAt = completedAt;
      logRecord.durationMs = durationMs;
      logRecord.totalVehiclesFetched = rawVehicles.length;
      logRecord.vehiclesProcessed = processedCount;
      logRecord.plantEntriesCount = entriesCount;
      logRecord.lastEvaluatedTimestamp = syncTime;
      await logRecord.save();
    }

    console.log(
      `[Wheelseye Auto-Sync SUCCESS] (${triggerType}): Processed ${processedCount}/${activeVehicles.length} vehicles in ${durationMs}ms. Evaluated: ${syncTime.toISOString()}`
    );

    return {
      success: true,
      message: 'Wheelseye GPS synchronization completed successfully.',
      triggerType,
      startedAt,
      completedAt,
      durationMs,
      totalVehiclesFetched: rawVehicles.length,
      vehiclesProcessed: processedCount,
      processedCount,
      plantEntriesRecorded: entriesCount,
      last_evaluated_timestamp: syncTime,
      lastSync: syncTime,
      next_sync_timestamp: getNextFixed30MinSlot(syncTime),
    };
  } catch (error) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    console.error(`[Wheelseye Auto-Sync FAILED] (${triggerType}):`, error.message);

    // Record failure in DB
    if (logRecord) {
      logRecord.status = 'FAILED';
      logRecord.completedAt = completedAt;
      logRecord.durationMs = durationMs;
      logRecord.errorDetails = error.message;
      await logRecord.save();
    }

    const config = await GpsSetting.findOne().sort({ updatedAt: -1 });
    if (config) {
      config.connectionStatus = 'Connection Failed';
      config.lastError = error.message;
      await config.save();
    }

    throw error;
  } finally {
    isSyncRunning = false;
  }
}

module.exports = {
  executeWheelseyeAutoSync,
  fetchWheelseyeTelemetry,
  DEFAULT_WHEELSEYE_URL,
};
