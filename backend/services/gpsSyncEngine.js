const Vehicle = require('../models/Vehicle');
const Plant = require('../models/Plant');
const GpsSetting = require('../models/GpsSetting');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const VehicleLocation = require('../models/VehicleLocation');
const PlantEntry = require('../models/PlantEntry');
const GpsSyncLog = require('../models/GpsSyncLog');
const GpsHistory = require('../models/GpsHistory');
const { normalizeVehicleNumber } = require('./gpsTimelineService');
const { fetchWheelseyeLiveTelemetry } = require('./wheelseyeService');
const { fetchFleetxLiveTelemetry, normalizeFleetxVehicleNumber } = require('./fleetxService');
const { getVehiclePlantStatus, calculateStayDuration } = require('./geofenceService');
const { getReadableLocation, isReadableProviderAddress } = require('./locationHelper');
const { reverseGeocode } = require('./reverseGeocodeService');
const { updateVehicleCurrentStatus } = require('./vehicleCurrentStatusService');
const { runGpsSyncExclusive } = require('./gpsSyncCoordinator');
const { isVehicleAssignedToProvider } = require('../utils/gpsProvider');
const { evaluateGeofenceConfirmation } = require('./geofenceConfirmation');
const { getZoneId, reconcileZoneSession } = require('./zoneSessionService');
const { getMissingProviderEnvironment } = require('../config/gpsConfig');

function normalizeNumber(num) {
  return String(num || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function getProviderSettingQuery(provider) {
  return provider === 'FLEETX'
    ? { $or: [{ provider: /fleetx/i }, { apiUrl: /fleetx/i }] }
    : { $or: [{ provider: /wheels/i }, { apiUrl: /wheelseye/i }] };
}

function getSafeErrorCode(error) {
  const status = Number(error?.response?.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) return `HTTP_${status}`;
  const code = String(error?.code || '').toUpperCase();
  if (/^[A-Z0-9_]{2,40}$/.test(code)) return code;
  const message = String(error?.message || '');
  if (/missing env:\s*([A-Z0-9_]+)/i.test(message)) {
    return `MISSING_ENV_${message.match(/missing env:\s*([A-Z0-9_]+)/i)[1].toUpperCase()}`;
  }
  if (/login failed|authentication failed/i.test(message)) return 'LOGIN_FAILED';
  if (/no vehicles/i.test(message)) return 'NO_VEHICLES';
  if (/vehicle not matched|vehicle not returned/i.test(message)) return 'VEHICLE_NOT_MATCHED';
  if (/timeout/i.test(message)) return 'REQUEST_TIMEOUT';
  return 'SYNC_FAILED';
}

function getProviderErrorMessage(provider, errorCode) {
  if (String(errorCode).startsWith('MISSING_ENV_')) {
    return `Server setting missing: ${errorCode.slice('MISSING_ENV_'.length)}`;
  }
  if (provider === 'WHEELSEYE' && errorCode === 'HTTP_401') {
    return 'WheelsEye token invalid or expired - update it in server settings';
  }
  if (provider === 'FLEETX') {
    if (errorCode === 'LOGIN_FAILED') return 'FleetX login failed';
    if (errorCode === 'NO_VEHICLES') return 'No vehicles returned by FleetX';
    if (errorCode === 'VEHICLE_NOT_MATCHED') return 'Vehicle not matched in FleetX telemetry';
    if (/^HTTP_\d{3}$/.test(errorCode)) return `FleetX live API returned ${errorCode}`;
  }
  return errorCode;
}

function recordFailure(failureReasons, code) {
  failureReasons[code] = (failureReasons[code] || 0) + 1;
}

function sanitizeStoredError(value) {
  const message = String(value || '').trim();
  if (!message) return '';
  if (/^[A-Z0-9_]{2,40}$/.test(message)) return message;
  const status = message.match(/\bHTTP[_\s]+(\d{3})\b/i);
  if (status) return `HTTP_${status[1]}`;
  if (/timeout/i.test(message)) return 'REQUEST_TIMEOUT';
  return 'SYNC_FAILED';
}

function getSyncOutcome({ fetchFailed, failedCount, savedCount, unchangedCount }) {
  const status = fetchFailed
    ? 'FAILED'
    : failedCount === 0
      ? 'SUCCESS'
      : savedCount > 0 || unchangedCount > 0
        ? 'PARTIAL'
        : 'FAILED';
  return { status, success: status !== 'FAILED' };
}

async function getProviderLocationText(latitude, longitude, plants, plantName, providerAddress) {
  if (plantName) return plantName;
  if (isReadableProviderAddress(providerAddress)) return providerAddress.trim();
  try {
    const address = await reverseGeocode(latitude, longitude);
    if (address) return address;
  } catch (error) {
    console.warn('[GPS geocoder] Reverse lookup unavailable:', getSafeErrorCode(error));
  }
  return getReadableLocation(latitude, longitude, plants);
}

/**
 * Synchronizes GPS telemetry for a specific provider (WheelsEye or FleetX).
 * Can be run in AUTO mode (only Active vehicles with gps_mode === 'AUTO')
 * or MANUAL mode (all Active vehicles assigned to that provider).
 */
async function runProviderGpsSync({ provider = 'WHEELSEYE', mode = 'AUTO', caller = 'SCHEDULER' } = {}) {
  const targetProvider = provider.toUpperCase() === 'FLEETX' ? 'FLEETX' : 'WHEELSEYE';
  const isAuto = mode.toUpperCase() === 'AUTO';
  const syncId = `sync_${targetProvider.toLowerCase()}_${Date.now()}`;
  const startedAt = new Date();

  console.log(`[GPS Sync Engine] Starting ${isAuto ? 'AUTO' : 'MANUAL'} sync for ${targetProvider}...`);

  // Build query for vehicles belonging to this provider
  const vehicleQuery = targetProvider === 'FLEETX'
    ? {}
    : {
        $or: [
          { gps_provider: targetProvider },
          { gps_provider: 'BOTH' },
          { gpsProvider: targetProvider.toLowerCase() },
          { gpsProvider: targetProvider },
          { gpsProviders: { $in: ['WheelsEye GPS'] } },
        ],
      };

  if (isAuto) {
    vehicleQuery.status = 'Active';
    vehicleQuery.gps_mode = 'AUTO';
  } else {
    // In manual mode, sync all Active vehicles registered to this provider
    vehicleQuery.status = 'Active';
  }

  const registeredVehicles = (await Vehicle.find(vehicleQuery))
    .filter((vehicle) => isVehicleAssignedToProvider(vehicle, targetProvider));
  const activePlants = await Plant.find({ status: 'Active' });
  const providerName = targetProvider === 'FLEETX' ? 'FleetX' : 'WheelsEye GPS';
  const providerSettingQuery = getProviderSettingQuery(targetProvider);

  try {
    await GpsSetting.findOneAndUpdate(
      providerSettingQuery,
      {
        $set: {
          provider: providerName,
          lastSync: startedAt,
          last_evaluated_timestamp: startedAt,
          last_sync_status: 'RUNNING',
          last_sync_source: isAuto ? 'GPS-AUTO' : 'MANUAL',
          connectionStatus: 'Syncing',
        },
        $setOnInsert: {
          apiUrl: targetProvider === 'FLEETX'
            ? process.env.FLEETX_API_BASE_URL || 'https://api.fleetx.io'
            : process.env.WHEELSEYE_API_URL || 'https://api.wheelseye.com/currentLoc',
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  } catch (settingError) {
    console.warn(`[GPS Sync Engine] Could not mark ${targetProvider} as syncing: ${getSafeErrorCode(settingError)}`);
  }

  let telemetryItems = [];
  let fetchError = null;

  try {
    const missingEnvironment = getMissingProviderEnvironment(targetProvider);
    if (missingEnvironment.length) {
      const missingError = new Error(`Missing env: ${missingEnvironment[0]}`);
      missingError.code = `MISSING_ENV_${missingEnvironment[0]}`;
      throw missingError;
    }
    if (targetProvider === 'FLEETX') {
      telemetryItems = await fetchFleetxLiveTelemetry();
    } else {
      telemetryItems = await fetchWheelseyeLiveTelemetry();
    }
  } catch (err) {
    fetchError = err;
    console.error(`[GPS Sync Engine] Telemetry fetch failed for ${targetProvider}: ${getSafeErrorCode(err)}`);
  }
  if (!fetchError && telemetryItems.length === 0) {
    fetchError = new Error('No vehicles returned by provider.');
    fetchError.code = 'NO_VEHICLES';
  }
  const receivedCount = Array.isArray(telemetryItems) ? telemetryItems.length : 0;

  // Map telemetry items by normalized vehicle number
  const telemetryByNumber = new Map();
  if (telemetryItems && Array.isArray(telemetryItems)) {
    for (const item of telemetryItems) {
      if (item) {
        const candidates = item.vehicleNumberCandidates?.length
          ? item.vehicleNumberCandidates
          : [item.vehicleNumber, item.vehicleName].filter(Boolean).map(normalizeFleetxVehicleNumber);
        for (const candidate of candidates) {
          if (candidate) telemetryByNumber.set(normalizeNumber(candidate), item);
        }
      }
    }
  }

  let successCount = 0;
  let failedCount = 0;
  let matchedCount = 0;
  let unchangedCount = 0;
  const failureReasons = {};
  const now = new Date();

  for (const vehicle of registeredVehicles) {
    let failureCounted = false;
    try {
    const cleanNum = normalizeNumber(vehicle.vehicleNumber);
    const telemetry = telemetryByNumber.get(cleanNum);
    if (telemetry) matchedCount++;

    const providerName = targetProvider === 'FLEETX' ? 'FleetX' : 'WheelsEye GPS';
    const curStatus = await VehicleCurrentStatus.findOne({ vehicleId: vehicle._id });
    const previousProviderFix = await GpsHistory.findOne({
      vehicleId: vehicle._id,
      provider: providerName,
      archived: { $ne: true },
    })
      .select('latitude longitude gpsTimestamp geofence_status candidateGeofenceStatus candidatePlantId plantId statusEligible')
      .sort({ gpsTimestamp: -1 })
      .lean();

    const hasValidCoordinates = telemetry &&
      Number.isFinite(telemetry.latitude) &&
      Number.isFinite(telemetry.longitude) &&
      telemetry.latitude >= -90 && telemetry.latitude <= 90 &&
      telemetry.longitude >= -180 && telemetry.longitude <= 180 &&
      !(telemetry.latitude === 0 && telemetry.longitude === 0);
    if (fetchError || !telemetry || !hasValidCoordinates) {
      failedCount++;
      failureCounted = true;
      const errorCode = fetchError
        ? getSafeErrorCode(fetchError)
        : !telemetry
          ? 'VEHICLE_NOT_MATCHED'
          : 'INVALID_COORDINATES';
      recordFailure(failureReasons, errorCode);

      vehicle.gps_sync_status = fetchError ? 'FAILED' : 'DATA_UNAVAILABLE';
      vehicle.gps_error_message = errorCode;
      await vehicle.save();

      await updateVehicleCurrentStatus(vehicle._id, {
        vehicleNumber: vehicle.vehicleNumber,
        provider: providerName,
        gps_status: fetchError ? 'GPS SYNC FAILED' : 'GPS DATA UNAVAILABLE',
        last_sync_source: isAuto ? 'GPS-AUTO' : 'MANUAL',
      });
      continue;
    }

    // Telemetry is present and valid
    const lat = telemetry.latitude;
    const lon = telemetry.longitude;
    const speed = telemetry.speed;
    const isIgnition = telemetry.ignition;
    const ignitionStatus = isIgnition === null || isIgnition === undefined ? null : (isIgnition ? 'ON' : 'OFF');
    const gpsTimestamp = telemetry.timestamp || null;

    if (!gpsTimestamp) {
      failedCount++;
      failureCounted = true;
      recordFailure(failureReasons, 'GPS_TIMESTAMP_MISSING');
      vehicle.gps_sync_status = 'DATA_UNAVAILABLE';
      vehicle.gps_error_message = 'GPS_TIMESTAMP_MISSING';
      await vehicle.save();
      continue;
    }
    if (gpsTimestamp > now) {
      failedCount++;
      failureCounted = true;
      recordFailure(failureReasons, 'FUTURE_GPS_TIMESTAMP');
      vehicle.gps_sync_status = 'DATA_UNAVAILABLE';
      vehicle.gps_error_message = 'FUTURE_GPS_TIMESTAMP';
      await vehicle.save();
      continue;
    }

    const sameProviderStatusTime = curStatus?.provider === providerName && curStatus.latest_gps_timestamp
      ? new Date(curStatus.latest_gps_timestamp)
      : null;
    const latestStoredTimestamp = previousProviderFix?.gpsTimestamp
      ? new Date(previousProviderFix.gpsTimestamp)
      : sameProviderStatusTime;
    if (latestStoredTimestamp && !Number.isNaN(latestStoredTimestamp.getTime()) && gpsTimestamp <= latestStoredTimestamp) {
      unchangedCount++;
      continue;
    }

    let prevEntryTime = curStatus ? curStatus.lastEntryDateTime : null;
    let prevExitTime = curStatus ? curStatus.lastExitDateTime : null;
    let prevExitPlant = curStatus ? curStatus.lastExitPlantName : null;

    // Single source of truth plant geofence evaluation
    const plantEval = getVehiclePlantStatus(
      { latitude: lat, longitude: lon, gpsTimestamp, entryDateTime: prevEntryTime },
      activePlants,
      { now }
    );

    const candidateGeofenceStatus = plantEval.isStale
      ? 'UNKNOWN'
      : plantEval.isInside ? 'INSIDE' : 'OUTSIDE';
    const confirmation = evaluateGeofenceConfirmation({
      currentStatus: curStatus,
      previousFix: previousProviderFix,
      candidateStatus: candidateGeofenceStatus,
      candidatePlantId: plantEval.isInside ? plantEval.plantId : null,
      gpsTimestamp,
    });
    const geofenceStatus = confirmation.status;
    const isInside = geofenceStatus === 'INSIDE';
    const plantId = isInside ? confirmation.plantId : null;
    const confirmedPlant = isInside
      ? activePlants.find((plant) => plant._id.toString() === plantId?.toString())
      : null;
    const plantName = confirmedPlant?.plantName ||
      (isInside && curStatus?.currentPlantId?.toString() === plantId?.toString()
        ? curStatus.current_plant
        : '');
    const readableLoc = await getProviderLocationText(
      lat,
      lon,
      activePlants,
      isInside ? plantName : '',
      telemetry.address
    );
    const transitionTime = confirmation.transitionGpsTimestamp || gpsTimestamp;

    let entryDateTime = isInside ? prevEntryTime : null;
    if (confirmation.transition === 'ENTRY' || confirmation.transition === 'PLANT_CHANGE') {
      entryDateTime = transitionTime;
      if (confirmation.transition === 'PLANT_CHANGE' && curStatus?.currentPlantId) {
        const prevPlant = activePlants.find((plant) => plant._id.toString() === curStatus.currentPlantId.toString());
        prevExitPlant = prevPlant ? prevPlant.plantName : curStatus.current_plant;
        prevExitTime = transitionTime;
      }

      const eventMinute = Math.floor(transitionTime.getTime() / 60000);
      const transitionKey = `${vehicle._id}:${plantId}:${eventMinute}`;
      const entryFix = previousProviderFix?.gpsTimestamp &&
        new Date(previousProviderFix.gpsTimestamp).getTime() === transitionTime.getTime()
        ? previousProviderFix
        : { latitude: lat, longitude: lon };
      await PlantEntry.updateOne(
        { transitionKey },
        {
          $setOnInsert: {
            vehicleId: vehicle._id,
            vehicleNumber: vehicle.vehicleNumber,
            plantId,
            plantName,
            entryDateTime,
            detectedAt: now,
            gpsTimestamp: transitionTime,
            syncTime: now,
            syncId,
            syncType: isAuto ? 'AUTO' : 'MANUAL',
            latitude: entryFix.latitude,
            longitude: entryFix.longitude,
            distanceMeter: plantEval.distanceMeter,
            plantRadiusMeters: plantEval.plantRadiusMeters,
            transitionKey,
          },
        },
        { upsert: true }
      );
    }

    if (confirmation.transition === 'EXIT') {
      const prevPlant = curStatus?.currentPlantId
        ? activePlants.find((plant) => plant._id.toString() === curStatus.currentPlantId.toString())
        : null;
      prevExitPlant = prevPlant ? prevPlant.plantName : curStatus?.current_plant;
      prevExitTime = transitionTime;
      entryDateTime = null;
    }

    if (geofenceStatus !== 'UNKNOWN') {
      await reconcileZoneSession({
        vehicleId: vehicle._id,
        vehicleNumber: vehicle.vehicleNumber,
        zoneId: geofenceStatus === 'INSIDE' ? getZoneId(plantName, plantId) : 'OUTSIDE',
        plantId,
        gpsTimestamp,
        transitionGpsTimestamp: confirmation.transitionGpsTimestamp,
        syncTime: now,
        provider: providerName,
        syncId,
        syncType: isAuto ? 'AUTO' : 'MANUAL',
      }, curStatus);
    }

    const calculatedStay = isInside
      ? calculateStayDuration(entryDateTime, gpsTimestamp, plantEval.isStale, now)
      : '00:00';

    // Update Vehicle model with realtime snapshot (Requirement 8)
    vehicle.gps_latitude = lat;
    vehicle.gps_longitude = lon;
    vehicle.gps_speed = speed;
    vehicle.gps_ignition_status = ignitionStatus;
    vehicle.gps_location = readableLoc;
    vehicle.gps_last_updated_at = gpsTimestamp;
    vehicle.gps_sync_status = 'SUCCESS';
    vehicle.gps_error_message = '';
    await vehicle.save();

    // Update VehicleCurrentStatus
    const statusPayload = {
      vehicleNumber: vehicle.vehicleNumber,
      provider: targetProvider === 'FLEETX' ? 'FleetX' : 'WheelsEye GPS',
      currentPlantId: plantId,
      current_plant: plantName || null,
      current_geofence: geofenceStatus,
      status: isInside ? 'Inside' : 'Outside',
      latitude: lat,
      longitude: lon,
      address: readableLoc,
      distanceMeter: plantEval.distanceMeter,
      latest_gps_timestamp: gpsTimestamp,
      last_successful_sync_at: now,
      gps_status: plantEval.gps_status,
      last_sync_source: isAuto ? 'GPS-AUTO' : 'MANUAL',
      stayHours: calculatedStay,
      speed,
      ignition: isIgnition,
      movementStatus: telemetry.status === 'Moving' ? 'Moving' : telemetry.status === 'Stopped' ? 'Stopped' : null,
      lastEntryDateTime: entryDateTime,
      lastExitPlantName: prevExitPlant,
      lastExitDateTime: prevExitTime,
      lastUpdatedAt: now,
    };

    await updateVehicleCurrentStatus(vehicle._id, statusPayload);

    // Insert into VehicleLocation history (deduplicated by vehicleId + gpsDateTime)
    const existingLoc = await VehicleLocation.findOne({
      vehicleId: vehicle._id,
      gpsDateTime: gpsTimestamp,
    });

    if (!existingLoc) {
      await VehicleLocation.create({
        vehicleId: vehicle._id,
        vehicleNumber: vehicle.vehicleNumber,
        latitude: lat,
        longitude: lon,
        gpsDateTime: gpsTimestamp,
        receivedAt: now,
        speed,
        ignition: isIgnition,
        movementStatus: telemetry.status === 'Moving' ? 'Moving' : telemetry.status === 'Stopped' ? 'Stopped' : null,
        address: readableLoc,
        geofence_status: geofenceStatus,
        plant_id: plantId,
        plantName,
        sync_source: isAuto ? 'GPS-AUTO' : 'MANUAL',
        source: targetProvider === 'FLEETX' ? 'FleetX' : 'WheelsEye GPS',
        provider: targetProvider === 'FLEETX' ? 'FleetX' : 'WheelsEye GPS',
      });
    }

    await GpsHistory.updateOne(
      {
        vehicleNumberNormalized: normalizeVehicleNumber(vehicle.vehicleNumber),
        provider: targetProvider === 'FLEETX' ? 'FleetX' : 'WheelsEye GPS',
        gpsTimestamp,
      },
      {
        $set: {
          vehicleId: vehicle._id,
          vehicleNumber: vehicle.vehicleNumber,
          latitude: lat,
          longitude: lon,
          speed,
          ignition: isIgnition,
          address: readableLoc,
          syncTime: now,
          syncId,
          syncType: isAuto ? 'AUTO' : 'MANUAL',
          geofence_status: geofenceStatus,
          candidateGeofenceStatus,
          candidatePlantId: plantEval.isInside ? plantEval.plantId : null,
          statusEligible: !plantEval.isStale,
          plantId: plantId,
          plantName,
          distanceMeter: plantEval.distanceMeter,
        },
      },
      { upsert: true }
    );

    successCount++;
    } catch (syncError) {
      const errorCode = getSafeErrorCode(syncError);
      if (!failureCounted) failedCount++;
      recordFailure(failureReasons, errorCode);
      try {
        vehicle.gps_sync_status = 'FAILED';
        vehicle.gps_error_message = errorCode;
        await vehicle.save();
      } catch (statusError) {
        console.error(`[GPS Sync Engine] Could not mark ${targetProvider} vehicle failure: ${getSafeErrorCode(statusError)}`);
      }
      console.error(`[GPS Sync Engine] ${targetProvider} vehicle update failed: ${errorCode}`);
    }
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();
  const { status: overallStatus, success: syncSucceeded } = getSyncOutcome({
    fetchFailed: Boolean(fetchError),
    failedCount,
    savedCount: successCount,
    unchangedCount,
  });
  console.log(
    `[GPS Sync Result] ${targetProvider === 'FLEETX' ? 'FleetX' : 'WheelsEye'}: ` +
    `${receivedCount} received, ${matchedCount} matched, ${successCount} saved, ` +
    `${failedCount} failed${Object.keys(failureReasons).length ? ` (${JSON.stringify(failureReasons)})` : ''}.`
  );

  // Record history in GpsSyncLog
  try {
    await GpsSyncLog.create({
      syncId,
      startedAt,
      completedAt,
      status: overallStatus,
      source: isAuto ? 'GPS-AUTO' : 'AUTO',
      syncType: isAuto ? 'AUTO' : 'MANUAL',
      triggerType: `${targetProvider}_${mode}_SYNC`,
      vehiclesFound: registeredVehicles.length,
      vehiclesProcessed: registeredVehicles.length,
      vehiclesUpdated: successCount,
      vehiclesFailed: failedCount,
      telemetryReceived: receivedCount,
      vehiclesMatched: matchedCount,
      vehiclesSaved: successCount,
      unchangedCount,
      failureReasons,
      apiResponseStatus: fetchError ? getSafeErrorCode(fetchError) : '200 OK',
      errorMessage: fetchError ? getSafeErrorCode(fetchError) : '',
      executionTimeMs: durationMs,
      provider: targetProvider === 'FLEETX' ? 'FleetX' : 'WheelsEye GPS',
    });
  } catch (logErr) {
    console.warn('[GPS Sync Log Error]:', getSafeErrorCode(logErr));
  }

  // Update GpsSetting document for provider
  try {
    const providerQuery =
      targetProvider === 'FLEETX'
        ? { $or: [{ provider: /fleetx/i }, { apiUrl: /fleetx/i }] }
        : { $or: [{ provider: /wheels/i }, { apiUrl: /wheelseye/i }] };

    await GpsSetting.findOneAndUpdate(
      providerQuery,
      {
        $set: {
          lastSync: completedAt,
          last_evaluated_timestamp: completedAt,
          last_sync_status: overallStatus,
          last_sync_source: isAuto ? 'GPS-AUTO' : 'MANUAL',
          lastError: fetchError
            ? getProviderErrorMessage(targetProvider, getSafeErrorCode(fetchError))
            : failedCount
              ? getProviderErrorMessage(targetProvider, Object.keys(failureReasons)[0])
              : '',
          lastErrorCode: fetchError ? getSafeErrorCode(fetchError) : failedCount ? Object.keys(failureReasons)[0] : '',
          connectionStatus: fetchError ? 'Connection Failed' : 'Connected',
          ...(fetchError ? {} : { lastSuccessAt: completedAt }),
          ...(fetchError ? { lastErrorAt: completedAt } : { lastErrorAt: null }),
          lastConnectionCheckAt: completedAt,
          vehicles_processed: registeredVehicles.length,
          vehicles_updated: successCount,
          vehicles_failed: failedCount,
        },
      },
      { upsert: true }
    );
  } catch (setErr) {
    console.warn('[GpsSetting Update Warning]:', getSafeErrorCode(setErr));
  }

  return {
    success: syncSucceeded,
    status: overallStatus,
    provider: targetProvider,
    mode,
    totalVehicles: registeredVehicles.length,
    receivedCount,
    matchedCount,
    savedCount: successCount,
    unchangedCount,
    successCount,
    failedCount,
    failureReasons,
    errorCode: fetchError ? getSafeErrorCode(fetchError) : null,
    durationMs,
    lastSuccessfulSyncAt: fetchError ? null : completedAt,
  };
}

function syncProviderGps(options = {}) {
  const provider = options.provider || 'WHEELSEYE';
  return runGpsSyncExclusive(
    () => runProviderGpsSync(options),
    `${provider.toUpperCase()}_GPS_SYNC`
  );
}

async function syncBothGpsProviders({ mode = 'MANUAL', caller = 'Admin' } = {}) {
  const [wheelsEye, fleetx] = await Promise.allSettled([
    syncProviderGps({ provider: 'WHEELSEYE', mode, caller }),
    syncProviderGps({ provider: 'FLEETX', mode, caller }),
  ]);
  return {
    wheelseye: wheelsEye.status === 'fulfilled'
      ? wheelsEye.value
      : { success: false, status: 'FAILED', errorCode: getSafeErrorCode(wheelsEye.reason), totalVehicles: 0, receivedCount: 0, matchedCount: 0, savedCount: 0, failedCount: 0, failureReasons: {} },
    fleetx: fleetx.status === 'fulfilled'
      ? fleetx.value
      : { success: false, status: 'FAILED', errorCode: getSafeErrorCode(fleetx.reason), totalVehicles: 0, receivedCount: 0, matchedCount: 0, savedCount: 0, failedCount: 0, failureReasons: {} },
  };
}

/**
 * Returns complete provider-wise overview data for the GPS Telematics Integration page.
 */
async function getProviderTelematicsOverview() {
  const activePlants = await Plant.find({ status: 'Active' });
  const allVehicles = await Vehicle.find();

  const statuses = await VehicleCurrentStatus.find().populate('currentPlantId', 'plantName');
  const statusByVehId = new Map();
  for (const s of statuses) {
    if (s.vehicleId) {
      statusByVehId.set(s.vehicleId.toString(), s);
    }
  }

  const formatVehicleItem = (v) => {
    const st = statusByVehId.get(v._id.toString()) || {};
    const lat = typeof v.gps_latitude === 'number' ? v.gps_latitude : st.latitude;
    const lon = typeof v.gps_longitude === 'number' ? v.gps_longitude : st.longitude;
    const speed = typeof v.gps_speed === 'number' ? v.gps_speed : (st.speed || 0);
    const isIgnition =
      v.gps_ignition_status !== null
        ? v.gps_ignition_status === 'ON'
        : Boolean(st.ignition);
    const lastUpdate = v.gps_last_updated_at || st.latest_gps_timestamp || st.lastUpdatedAt || null;

    const plantEval = (lat && lon)
      ? getVehiclePlantStatus(
          { latitude: lat, longitude: lon, gpsTimestamp: lastUpdate, entryDateTime: st.lastEntryDateTime },
          activePlants
        )
      : {
          status: 'Outside',
          isInside: false,
          plantName: 'Outside All Plants',
          distanceMeter: null,
          gps_status: 'GPS DATA UNAVAILABLE',
        };

    const hasValidCoords = typeof lat === 'number' && typeof lon === 'number' && (lat !== 0 || lon !== 0);
    const googleMapsUrl = hasValidCoords
      ? `https://www.google.com/maps?q=${lat},${lon}`
      : null;

    // Determine UI sync status indicator
    let syncStatusBadge = 'UNAVAILABLE'; // Yellow
    if (v.status === 'Inactive') {
      syncStatusBadge = 'INACTIVE'; // Grey
    } else if (v.gps_sync_status === 'SUCCESS' && hasValidCoords) {
      syncStatusBadge = plantEval.gps_status === 'GPS STALE' ? 'STALE' : 'ACTIVE'; // Green or Amber
    } else if (v.gps_sync_status === 'FAILED') {
      syncStatusBadge = 'ERROR'; // Red
    }

    return {
      id: v._id,
      vehicleNumber: v.vehicleNumber,
      driverName: v.driverName || '—',
      mobile: v.mobile || '—',
      fleetType: v.fleetType,
      ownerName: v.ownerName || '—',
      gps_mode: v.gps_mode || 'AUTO',
      gps_provider: v.gps_provider || (v.gpsProvider ? v.gpsProvider.toUpperCase() : 'WHEELSEYE'),
      status: v.status,
      latitude: lat,
      longitude: lon,
      speed,
      ignition: isIgnition,
      ignitionStatus: isIgnition ? 'ON' : 'OFF',
      address: v.gps_location || st.address || (hasValidCoords ? getReadableLocation(lat, lon, activePlants) : 'No GPS Location'),
      lastUpdatedAt: lastUpdate,
      readableTime: lastUpdate
        ? new Date(lastUpdate).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          })
        : 'N/A',
      googleMapsUrl,
      syncStatus: syncStatusBadge,
      errorMessage: sanitizeStoredError(v.gps_error_message),
      geofence: {
        status: plantEval.status,
        plantName: plantEval.plantName,
        distanceMeter: plantEval.distanceMeter,
      },
      stayHours: plantEval.stayHours || '00:00',
    };
  };

  const wheelseyeVehicles = allVehicles
    .filter((v) => isVehicleAssignedToProvider(v, 'WHEELSEYE'))
    .map(formatVehicleItem);

  const fleetxVehicles = allVehicles
    .filter((v) => isVehicleAssignedToProvider(v, 'FLEETX'))
    .map(formatVehicleItem);

  // Load last sync times from GpsSetting
  const settings = await GpsSetting.find();
  const weSetting = settings.find((s) => s.provider && s.provider.toLowerCase().includes('wheels'));
  const fxSetting = settings.find((s) => s.provider && s.provider.toLowerCase().includes('fleetx'));

  const buildSection = (providerName, list, settingDoc) => {
    const totalRegistered = list.length;
    const totalActive = list.filter((v) => v.status === 'Active').length;
    const totalSynced = list.filter((v) => v.status === 'Active' && (v.syncStatus === 'ACTIVE' || v.syncStatus === 'STALE')).length;
    const totalErrors = list.filter((v) => v.status === 'Active' && (v.syncStatus === 'ERROR' || v.syncStatus === 'UNAVAILABLE')).length;

    return {
      provider: providerName,
      totalRegistered,
      totalActive,
      totalSynced,
      totalErrors,
      lastSync: settingDoc?.lastSync || null,
      lastSyncStatus: settingDoc?.last_sync_status || 'PENDING',
      vehicles: list,
    };
  };

  return {
    wheelseye: buildSection('WheelsEye GPS', wheelseyeVehicles, weSetting),
    fleetx: buildSection('FleetX GPS', fleetxVehicles, fxSetting),
  };
}

module.exports = {
  syncProviderGps,
  syncBothGpsProviders,
  getProviderTelematicsOverview,
  getSyncOutcome,
};
