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
const { getReadableLocation } = require('./locationHelper');
const { updateVehicleCurrentStatus } = require('./vehicleCurrentStatusService');
const { runGpsSyncExclusive } = require('./gpsSyncCoordinator');
const { isVehicleAssignedToProvider } = require('../utils/gpsProvider');
const { evaluateGeofenceConfirmation } = require('./geofenceConfirmation');
const { getZoneId, reconcileZoneSession } = require('./zoneSessionService');

function normalizeNumber(num) {
  return (num || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function getProviderSettingQuery(provider) {
  return provider === 'FLEETX'
    ? { $or: [{ provider: /fleetx/i }, { apiUrl: /fleetx/i }] }
    : { $or: [{ provider: /wheels/i }, { apiUrl: /wheelseye/i }] };
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
    console.warn(`[GPS Sync Engine] Could not mark ${targetProvider} as syncing:`, settingError.message);
  }

  let telemetryItems = [];
  let fetchError = null;

  try {
    if (targetProvider === 'FLEETX') {
      telemetryItems = await fetchFleetxLiveTelemetry();
    } else {
      telemetryItems = await fetchWheelseyeLiveTelemetry();
    }
  } catch (err) {
    fetchError = err;
    console.error(`[GPS Sync Engine] Telemetry fetch failed for ${targetProvider}: ${err.message}`);
  }

  // Map telemetry items by normalized vehicle number
  const telemetryByNumber = new Map();
  if (telemetryItems && Array.isArray(telemetryItems)) {
    for (const item of telemetryItems) {
      if (item) {
        const candidates = item.vehicleNumberCandidates?.length
          ? item.vehicleNumberCandidates
          : [item.vehicleNumber, item.vehicleName].filter(Boolean).map(normalizeFleetxVehicleNumber);
        for (const candidate of candidates) {
          if (candidate) telemetryByNumber.set(candidate, item);
        }
      }
    }
  }

  let successCount = 0;
  let failedCount = 0;
  const now = new Date();

  for (const vehicle of registeredVehicles) {
    const cleanNum = normalizeNumber(vehicle.vehicleNumber);
    const telemetry = telemetryByNumber.get(cleanNum);

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

    if (fetchError || !telemetry || telemetry.latitude === null || telemetry.longitude === null) {
      failedCount++;
      const errorMsg = fetchError
        ? `API Error: ${fetchError.message}`
        : 'Vehicle not returned in GPS telematics stream';

      vehicle.gps_sync_status = fetchError ? 'FAILED' : 'DATA_UNAVAILABLE';
      vehicle.gps_error_message = errorMsg;
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
      vehicle.gps_sync_status = 'DATA_UNAVAILABLE';
      vehicle.gps_error_message = 'GPS record timestamp is missing';
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
      continue;
    }

    const readableLoc = getReadableLocation(lat, lon, activePlants) || telemetry.address || 'Outside';

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
      distanceMeter: plantEval.distanceMeter,
      latest_gps_timestamp: gpsTimestamp,
      last_successful_sync_at: now,
      gps_status: plantEval.gps_status,
      last_sync_source: isAuto ? 'GPS-AUTO' : 'MANUAL',
      stayHours: calculatedStay,
      speed,
      ignition: isIgnition,
      movementStatus: telemetry.status === 'Moving' ? 'Moving' : telemetry.status === 'Stopped' ? 'Stopped' : null,
      address: readableLoc,
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
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();
  const overallStatus = fetchError
    ? 'FAILED'
    : failedCount === 0
    ? 'SUCCESS'
    : successCount > 0
    ? 'PARTIAL'
    : 'FAILED';

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
      apiResponseStatus: fetchError ? `ERROR: ${fetchError.message}` : '200 OK',
      errorMessage: fetchError ? fetchError.message : '',
      executionTimeMs: durationMs,
      provider: targetProvider === 'FLEETX' ? 'FleetX' : 'WheelsEye GPS',
    });
  } catch (logErr) {
    console.warn('[GPS Sync Log Error]:', logErr.message);
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
          lastError: fetchError ? fetchError.message : '',
          connectionStatus: fetchError ? 'Connection Failed' : 'Connected',
          ...(fetchError ? {} : { lastSuccessAt: completedAt }),
          ...(fetchError ? { lastErrorAt: completedAt } : { lastErrorAt: null }),
          lastConnectionCheckAt: completedAt,
          vehicles_processed: registeredVehicles.length,
          vehicles_updated: successCount,
        },
      },
      { upsert: true }
    );
  } catch (setErr) {
    console.warn('[GpsSetting Update Warning]:', setErr.message);
  }

  return {
    success: !fetchError,
    provider: targetProvider,
    mode,
    totalVehicles: registeredVehicles.length,
    successCount,
    failedCount,
    errorMessage: fetchError ? fetchError.message : null,
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
      : { success: false, errorMessage: wheelsEye.reason?.message || 'WheelsEye sync failed.' },
    fleetx: fleetx.status === 'fulfilled'
      ? fleetx.value
      : { success: false, errorMessage: fleetx.reason?.message || 'FleetX sync failed.' },
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
      errorMessage: v.gps_error_message || '',
      geofence: {
        status: plantEval.status,
        plantName: plantEval.plantName,
        distanceMeter: plantEval.distanceMeter,
      },
      stayHours: plantEval.stayHours || '00:00',
    };
  };

  const wheelseyeVehicles = allVehicles
    .filter((v) => (v.gps_provider || v.gpsProvider || 'WHEELSEYE').toUpperCase() === 'WHEELSEYE')
    .map(formatVehicleItem);

  const fleetxVehicles = allVehicles
    .filter((v) => (v.gps_provider || v.gpsProvider || '').toUpperCase() === 'FLEETX')
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
};
