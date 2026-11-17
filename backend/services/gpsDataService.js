const Plant = require('../models/Plant');
const Vehicle = require('../models/Vehicle');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const GpsHistory = require('../models/GpsHistory');
const PlantStay = require('../models/PlantStay');
const ZoneSession = require('../models/ZoneSession');
const GpsSetting = require('../models/GpsSetting');
const {
  calculateHaversineDistance,
  getVehiclePlantStatus,
  getPlantRadiusMeters,
  isVerifiedGpsSample,
  msToHHMM,
} = require('./geofenceService');
const { GPS_STALE_THRESHOLD_MS: STALE_THRESHOLD_MS } = require('../config/gps');
const {
  MAX_GPS_GAP_MS,
  normalizeVehicleNumber,
  classifyGpsSample,
  uniqueChronologicalSamples,
  latestStayBounds,
} = require('./gpsTimelineService');

const ZONE_PLANT_IDS = { DASNA: 'DASNA', SALT: 'Salt Plant', TEA: 'Tea Plant' };

function isDashboardEligibleGpsVehicle(item) {
  return Boolean(item?.isRegistered === true &&
    item.vehicle?.status === 'Active' &&
    (item.hasGps === true || item.providerLocations?.some((location) => location.hasGps)));
}

function buildProviderLocation(provider, sample, session, plants, now, health) {
  if (!sample) {
    return {
      provider,
      hasGps: false,
      status: 'No GPS Data',
      plantName: null,
      latitude: null,
      longitude: null,
      providerTimestamp: null,
      systemSyncTimestamp: null,
      connectionStatus: health?.connectionStatus || 'Pending',
      lastSuccessfulSyncAt: health?.lastSuccessAt || null,
    };
  }

  const evaluation = getVehiclePlantStatus(
    {
      latitude: sample.latitude,
      longitude: sample.longitude,
      gpsTimestamp: sample.gpsTimestamp,
    },
    plants,
    { now, staleThresholdMs: STALE_THRESHOLD_MS }
  );
  const sessionIsCurrent = session &&
    new Date(session.lastSeenAt).getTime() >= new Date(sample.gpsTimestamp).getTime();
  const zoneId = sessionIsCurrent ? session.zoneId : null;
  const sessionPlantName = zoneId && zoneId !== 'OUTSIDE' ? ZONE_PLANT_IDS[zoneId] : null;
  const sessionPlant = sessionIsCurrent && session.plantId
    ? plants.find((plant) => plant._id.toString() === session.plantId.toString())
    : sessionPlantName
      ? plants.find((plant) => plant.plantName.toLowerCase().includes(sessionPlantName.toLowerCase()))
      : null;
  const isInside = sessionIsCurrent ? zoneId !== 'OUTSIDE' : evaluation.isInside;
  const plant = sessionIsCurrent
    ? (isInside
        ? { id: session.plantId || sessionPlant?._id, name: sessionPlant?.plantName || sessionPlantName }
        : null)
    : (evaluation.isInside ? { id: evaluation.plantId, name: evaluation.plantName } : null);
  const entryDateTime = isInside
    ? sessionIsCurrent
      ? session.entryGpsTimestamp || session.enteredAt
      : sample.gpsTimestamp
    : null;
  const durationEnd = !evaluation.isStale &&
    health?.connectionStatus === 'Connected' &&
    (health.consecutiveFailures || 0) === 0
    ? now.getTime()
    : new Date(sample.gpsTimestamp).getTime();

  return {
    provider,
    hasGps: true,
    status: isInside ? 'Inside' : 'Outside',
    plantName: plant?.name || null,
    plantId: plant?.id || null,
    latitude: sample.latitude,
    longitude: sample.longitude,
    speed: sample.speed ?? null,
    ignition: sample.ignition ?? null,
    movementStatus: sample.rawTelemetry?.movementStatus || null,
    rawTelemetry: sample.rawTelemetry || null,
    syncType: sample.syncType || null,
    providerTimestamp: sample.gpsTimestamp,
    systemSyncTimestamp: sample.syncTime || null,
    entryDateTime,
    stayHours: entryDateTime
      ? msToHHMM(durationEnd - new Date(entryDateTime).getTime())
      : '00:00',
    detectedAt: sessionIsCurrent ? session.detectedAt || session.enteredAt : null,
    gpsStatus: evaluation.gps_status,
    isStale: evaluation.isStale,
    distanceMeter: evaluation.distanceMeter,
    connectionStatus: health?.connectionStatus || 'Pending',
    lastSuccessfulSyncAt: health?.lastSuccessAt || null,
  };
}

function getLocationDiscrepancyMeters(providerLocations) {
  const locations = providerLocations.filter((location) =>
    location.hasGps &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude)
  );
  if (locations.length < 2) return null;
  return calculateHaversineDistance(
    locations[0].latitude,
    locations[0].longitude,
    locations[1].latitude,
    locations[1].longitude
  );
}

async function getFleetGpsSnapshot({ now = new Date(), dashboardOnly = false } = {}) {
  const [vehicles, plants, statuses, openSessions, fleetxOpenSessions, fleetxHistory, gpsSettings] = await Promise.all([
    Vehicle.find(dashboardOnly ? { status: 'Active' } : {}).sort({ vehicleNumber: 1 }),
    Plant.find({ status: 'Active' }).sort({ plantName: 1 }),
    VehicleCurrentStatus.find({ archived: { $ne: true }, provider: /wheels.?eye/i }),
    ZoneSession.find({ exitedAt: null, archived: { $ne: true }, provider: /wheels.?eye/i }),
    ZoneSession.find({ exitedAt: null, archived: { $ne: true }, provider: /fleetx/i }),
    GpsHistory.find({ provider: /fleetx/i, archived: { $ne: true } })
      .sort({ gpsTimestamp: 1, syncTime: 1 }),
    GpsSetting.find({
      archived: { $ne: true },
      $or: [{ provider: /wheels.?eye/i }, { provider: /fleetx/i }],
    })
      .select('provider status connectionStatus lastSuccessAt lastErrorAt lastErrorCode lastError consecutiveFailures'),
  ]);
  const history = await GpsHistory.find({
    provider: /wheels.?eye/i,
    archived: { $ne: true },
  }).sort({ gpsTimestamp: 1, syncTime: 1 });
  const historyByVehicleId = new Set();
  const historyByVehicleNumber = new Set();
  const byVehicleId = new Map();
  const byVehicleNumber = new Map();
  for (const point of history) {
    const numberKey = normalizeVehicleNumber(point.vehicleNumberNormalized || point.vehicleNumber);
    if (point.vehicleId) {
      const key = point.vehicleId.toString();
      historyByVehicleId.add(key);
    }
    historyByVehicleNumber.add(numberKey);
    if (!isVerifiedGpsSample(point)) continue;
    if (point.vehicleId) {
      const key = point.vehicleId.toString();
      if (!byVehicleId.has(key)) byVehicleId.set(key, []);
      byVehicleId.get(key).push(point);
    }
    if (!byVehicleNumber.has(numberKey)) byVehicleNumber.set(numberKey, []);
    byVehicleNumber.get(numberKey).push(point);
  }
  const statusByVehicleId = new Map(statuses.map((status) => [status.vehicleId.toString(), status]));
  const sessionByVehicleId = new Map(openSessions
    .filter((session) => session.vehicleId)
    .map((session) => [session.vehicleId.toString(), session]));
  const sessionByVehicleNumber = new Map(openSessions.map((session) => [
    normalizeVehicleNumber(session.vehicleNumberNormalized || session.vehicleNumber),
    session,
  ]));
  const fleetxSessionByVehicleId = new Map(fleetxOpenSessions
    .filter((session) => session.vehicleId)
    .map((session) => [session.vehicleId.toString(), session]));
  const fleetxSessionByVehicleNumber = new Map(fleetxOpenSessions.map((session) => [
    normalizeVehicleNumber(session.vehicleNumberNormalized || session.vehicleNumber),
    session,
  ]));
  const fleetxByVehicleId = new Map();
  const fleetxByVehicleNumber = new Map();
  for (const point of fleetxHistory) {
    const numberKey = normalizeVehicleNumber(point.vehicleNumberNormalized || point.vehicleNumber);
    if (!isVerifiedGpsSample(point)) continue;
    if (point.vehicleId) {
      const key = point.vehicleId.toString();
      if (!fleetxByVehicleId.has(key)) fleetxByVehicleId.set(key, []);
      fleetxByVehicleId.get(key).push(point);
    }
    if (!fleetxByVehicleNumber.has(numberKey)) fleetxByVehicleNumber.set(numberKey, []);
    fleetxByVehicleNumber.get(numberKey).push(point);
  }
  const providerHealthByName = new Map(gpsSettings.map((setting) => [
    /fleetx/i.test(setting.provider || '') ? 'Fleetx' : 'WheelsEye GPS',
    setting,
  ]));

  const fleet = vehicles.map((vehicle) => {
    const vehicleNumberNormalized = normalizeVehicleNumber(vehicle.vehicleNumber);
    const samples = byVehicleId.get(vehicle._id.toString()) || byVehicleNumber.get(vehicleNumberNormalized) || [];
    const fleetxSamples = fleetxByVehicleId.get(vehicle._id.toString()) ||
      fleetxByVehicleNumber.get(vehicleNumberNormalized) || [];
    const latestFleetxSample = fleetxSamples[fleetxSamples.length - 1] || null;
    const fleetxSession = fleetxSessionByVehicleId.get(vehicle._id.toString()) ||
      fleetxSessionByVehicleNumber.get(vehicleNumberNormalized);
    const fleetxLocation = buildProviderLocation(
      'Fleetx',
      latestFleetxSample,
      fleetxSession,
      plants,
      now,
      providerHealthByName.get('Fleetx')
    );
    const chronological = uniqueChronologicalSamples(samples, plants);
    const latestPoint = chronological[chronological.length - 1];
    let latestSample = latestPoint
      ? samples
          .filter((sample) => new Date(sample.gpsTimestamp).getTime() === latestPoint.time.getTime())
          .sort((a, b) => new Date(b.syncTime).getTime() - new Date(a.syncTime).getTime())[0]
      : null;
    const storedStatus = statusByVehicleId.get(vehicle._id.toString());
    const openSession = sessionByVehicleId.get(vehicle._id.toString()) ||
      sessionByVehicleNumber.get(vehicleNumberNormalized);
    if (!latestSample && latestFleetxSample) {
      const location = fleetxLocation;
      const gpsTimestamp = new Date(latestFleetxSample.gpsTimestamp);
      const durationEnd = !location.isStale &&
        location.connectionStatus === 'Connected' &&
        (providerHealthByName.get('Fleetx')?.consecutiveFailures || 0) === 0
        ? now.getTime()
        : gpsTimestamp.getTime();
      const stayHours = location.status === 'Inside' && location.entryDateTime
        ? msToHHMM(durationEnd - new Date(location.entryDateTime).getTime())
        : '00:00';
      const wheelseyeLocation = buildProviderLocation(
        'WheelsEye GPS',
        null,
        openSession,
        plants,
        now,
        providerHealthByName.get('WheelsEye GPS')
      );
      const providerLocations = [wheelseyeLocation, location];
      return {
        vehicle,
        storedStatus,
        samples: fleetxSamples,
        hasGps: true,
        status: location.status,
        plant: location.plantId ? { id: location.plantId, name: location.plantName } : null,
        plantName: location.plantName,
        distanceMeter: location.distanceMeter,
        gpsTimestamp,
        entryGpsTimestamp: location.entryDateTime,
        statusDetectedAt: location.detectedAt,
        outsideSince: location.status === 'Outside' ? fleetxSession?.enteredAt || null : null,
        isStale: location.isStale,
        gpsStatus: location.gpsStatus,
        stayHours,
        outsideHours: '00:00',
        latitude: latestFleetxSample.latitude,
        longitude: latestFleetxSample.longitude,
        speed: latestFleetxSample.speed,
        ignition: latestFleetxSample.ignition,
        provider: 'Fleetx',
        lastSyncType: latestFleetxSample.syncType || null,
        rawTelemetry: latestFleetxSample.rawTelemetry,
        providerUnavailable: location.connectionStatus !== 'Connected'
          ? { provider: 'Fleetx', lastSuccessAt: location.lastSuccessfulSyncAt }
          : null,
        providerLocations,
        locationDiscrepancyMeters: null,
        isRegistered: true,
      };
    }
    const hasHistory = historyByVehicleId.has(vehicle._id.toString()) ||
      historyByVehicleNumber.has(vehicleNumberNormalized);
    if (!latestSample && !hasHistory && storedStatus?.latest_gps_timestamp &&
        Number.isFinite(storedStatus.latitude) && Number.isFinite(storedStatus.longitude)) {
      latestSample = {
        vehicleId: vehicle._id,
        vehicleNumber: vehicle.vehicleNumber,
        latitude: storedStatus.latitude,
        longitude: storedStatus.longitude,
        gpsTimestamp: storedStatus.latest_gps_timestamp,
        speed: storedStatus.speed,
        ignition: storedStatus.ignition,
        provider: storedStatus.provider,
        rawTelemetry: storedStatus.rawTelemetry,
        syncType: storedStatus.lastSyncType || storedStatus.last_sync_source || null,
      };
    }
    if (!latestSample) {
      const savedProvider = storedStatus?.provider;
      const savedProviderHealth = savedProvider === 'WheelsEye GPS'
        ? providerHealthByName.get('WheelsEye GPS')
        : null;
      const wheelseyeLocation = buildProviderLocation(
        'WheelsEye GPS',
        null,
        openSession,
        plants,
        now,
        providerHealthByName.get('WheelsEye GPS')
      );
      const providerLocations = [wheelseyeLocation, fleetxLocation];
      return {
        vehicle,
        storedStatus,
        samples,
        hasGps: false,
        status: 'No GPS Data',
        plant: null,
        gpsTimestamp: null,
        entryGpsTimestamp: null,
        outsideSince: null,
        isStale: true,
        gpsStatus: 'GPS DATA UNAVAILABLE',
        stayHours: 'N/A',
        outsideHours: 'N/A',
        isRegistered: true,
        latitude: null,
        longitude: null,
        speed: null,
        ignition: null,
        provider: null,
        providerUnavailable: savedProvider && savedProviderHealth && savedProviderHealth.connectionStatus !== 'Connected'
          ? { provider: savedProvider, lastSuccessAt: savedProviderHealth.lastSuccessAt || null }
          : null,
        providerLocations,
        locationDiscrepancyMeters: getLocationDiscrepancyMeters(providerLocations),
      };
    }

    const evaluation = getVehiclePlantStatus(
      {
        latitude: latestSample.latitude,
        longitude: latestSample.longitude,
        gpsTimestamp: latestSample.gpsTimestamp,
      },
      plants,
      { now, staleThresholdMs: STALE_THRESHOLD_MS }
    );
    const sessionZone = openSession?.zoneId;
    const sessionPlantName = sessionZone && sessionZone !== 'OUTSIDE'
      ? ZONE_PLANT_IDS[sessionZone]
      : null;
    const sessionPlant = sessionPlantName
      ? plants.find((plant) => plant.plantName.toLowerCase().includes(sessionPlantName.toLowerCase()))
      : null;
    const sessionIsCurrent = openSession &&
      new Date(openSession.lastSeenAt).getTime() >= new Date(latestSample.gpsTimestamp).getTime();
    const isInside = sessionIsCurrent ? openSession.zoneId !== 'OUTSIDE' : evaluation.isInside;
    const plant = sessionIsCurrent
      ? (isInside ? { id: openSession.plantId || sessionPlant?._id, name: sessionPlantName } : null)
      : (evaluation.isInside ? { id: evaluation.plantId, name: evaluation.plantName } : null);
    const bounds = latestStayBounds(
      samples,
      plants,
      classifyGpsSample(latestSample, plants),
      MAX_GPS_GAP_MS
    );
    const gpsTimestamp = new Date(latestSample.gpsTimestamp);
    const sampleProvider = latestSample.provider || storedStatus?.provider || null;
    const sampleProviderHealth = sampleProvider === 'WheelsEye GPS'
      ? providerHealthByName.get('WheelsEye GPS')
      : null;
    const entryGpsTimestamp = sessionIsCurrent
      ? openSession.entryGpsTimestamp || openSession.enteredAt
      : bounds.entryGpsTimestamp;
    const statusDetectedAt = sessionIsCurrent
      ? openSession.detectedAt || openSession.enteredAt
      : (isInside
          ? storedStatus?.lastEntryDetectedAt || bounds.entryGpsTimestamp
          : storedStatus?.lastExitDetectedAt || bounds.outsideSince);
    const durationEnd = !evaluation.isStale &&
      sampleProviderHealth?.connectionStatus === 'Connected' &&
      (sampleProviderHealth.consecutiveFailures || 0) === 0
      ? now.getTime()
      : gpsTimestamp.getTime();
    const stayHours = isInside && entryGpsTimestamp
      ? msToHHMM(durationEnd - new Date(entryGpsTimestamp).getTime())
      : '00:00';
    const outsideSince = sessionIsCurrent && openSession.zoneId === 'OUTSIDE'
      ? openSession.enteredAt
      : bounds.outsideSince;
    const outsideHours = outsideSince
      ? msToHHMM(durationEnd - new Date(outsideSince).getTime())
      : '00:00';

    const wheelseyeLocation = buildProviderLocation(
      'WheelsEye GPS',
      latestSample,
      openSession,
      plants,
      now,
      providerHealthByName.get('WheelsEye GPS')
    );
    const providerLocations = [wheelseyeLocation, fleetxLocation];
    return {
      vehicle,
      storedStatus,
      samples,
      hasGps: true,
      status: isInside ? 'Inside' : 'Outside',
      plant,
      plantName: plant?.name || null,
      distanceMeter: evaluation.distanceMeter,
      gpsTimestamp,
      entryGpsTimestamp,
      statusDetectedAt,
      outsideSince,
      isStale: evaluation.isStale,
      gpsStatus: evaluation.gps_status,
      stayHours: isInside ? stayHours : '00:00',
      outsideHours: isInside ? '00:00' : outsideHours,
      latitude: latestSample.latitude,
      longitude: latestSample.longitude,
      speed: latestSample.speed,
      ignition: latestSample.ignition,
      provider: sampleProvider,
      lastSyncType: storedStatus?.lastSyncType || storedStatus?.last_sync_source || latestSample.syncType || null,
      rawTelemetry: latestSample.rawTelemetry,
      providerUnavailable: sampleProviderHealth && sampleProviderHealth.connectionStatus !== 'Connected'
        ? {
            provider: sampleProvider || 'GPS Provider',
            lastSuccessAt: sampleProviderHealth.lastSuccessAt || null,
          }
        : null,
      providerLocations,
      locationDiscrepancyMeters: getLocationDiscrepancyMeters(providerLocations),
      isRegistered: true,
    };
  });

  if (!dashboardOnly) {
    const registeredNumbers = new Set(vehicles.map((vehicle) => normalizeVehicleNumber(vehicle.vehicleNumber)));
    for (const [vehicleNumberNormalized, samples] of byVehicleNumber) {
      if (registeredNumbers.has(vehicleNumberNormalized)) continue;
      const latestSample = samples.reduce((latest, sample) => (
        !latest || new Date(sample.gpsTimestamp) > new Date(latest.gpsTimestamp) ? sample : latest
      ), null);
      if (!latestSample) continue;

      const evaluation = getVehiclePlantStatus(
        {
          latitude: latestSample.latitude,
          longitude: latestSample.longitude,
          gpsTimestamp: latestSample.gpsTimestamp,
        },
        plants,
        { now, staleThresholdMs: STALE_THRESHOLD_MS }
      );
      const openSession = sessionByVehicleNumber.get(vehicleNumberNormalized);
      const sessionIsCurrent = openSession &&
        new Date(openSession.lastSeenAt).getTime() >= new Date(latestSample.gpsTimestamp).getTime();
      const sessionZone = sessionIsCurrent ? openSession.zoneId : null;
      const sessionPlantName = sessionZone && sessionZone !== 'OUTSIDE'
        ? ZONE_PLANT_IDS[sessionZone]
        : null;
      const sessionPlant = sessionPlantName
        ? plants.find((plant) => plant.plantName.toLowerCase().includes(sessionPlantName.toLowerCase()))
        : null;
      const isInside = sessionIsCurrent ? sessionZone !== 'OUTSIDE' : evaluation.isInside;
      const plant = sessionIsCurrent
        ? (isInside ? { id: openSession.plantId || sessionPlant?._id, name: sessionPlantName } : null)
        : (evaluation.isInside ? { id: evaluation.plantId, name: evaluation.plantName } : null);
      const entryGpsTimestamp = sessionIsCurrent
        ? openSession.entryGpsTimestamp || openSession.enteredAt
        : latestStayBounds(samples, plants, classifyGpsSample(latestSample, plants), MAX_GPS_GAP_MS).entryGpsTimestamp;
      const statusDetectedAt = sessionIsCurrent
        ? openSession.detectedAt || openSession.enteredAt
        : (isInside
            ? latestStayBounds(samples, plants, classifyGpsSample(latestSample, plants), MAX_GPS_GAP_MS).entryGpsTimestamp
            : latestStayBounds(samples, plants, 'Outside', MAX_GPS_GAP_MS).outsideSince);
      const providerHealth = providerHealthByName.get('WheelsEye GPS');
      const durationEnd = !evaluation.isStale &&
        providerHealth?.connectionStatus === 'Connected' &&
        (providerHealth.consecutiveFailures || 0) === 0
        ? now.getTime()
        : new Date(latestSample.gpsTimestamp).getTime();
      const stayHours = isInside && entryGpsTimestamp
        ? msToHHMM(durationEnd - new Date(entryGpsTimestamp).getTime())
        : '00:00';
      const vehicleNumber = latestSample.vehicleNumber || vehicleNumberNormalized;

      fleet.push({
        vehicle: {
          _id: `gps-unregistered-${vehicleNumberNormalized}`,
          vehicleNumber,
          driverName: 'Not registered',
          mobile: '',
          fleetType: 'Not registered',
          gpsDeviceId: '',
        },
        storedStatus: null,
        samples,
        hasGps: true,
        isRegistered: false,
        status: isInside ? 'Inside' : 'Outside',
        plant,
        plantName: plant?.name || null,
        distanceMeter: evaluation.distanceMeter,
        gpsTimestamp: new Date(latestSample.gpsTimestamp),
        entryGpsTimestamp,
        statusDetectedAt,
        outsideSince: sessionIsCurrent && sessionZone === 'OUTSIDE'
          ? openSession.enteredAt
          : latestStayBounds(samples, plants, 'Outside', MAX_GPS_GAP_MS).outsideSince,
        isStale: evaluation.isStale,
        gpsStatus: evaluation.gps_status,
        stayHours: isInside ? stayHours : '00:00',
        outsideHours: !isInside && sessionIsCurrent && openSession.zoneId === 'OUTSIDE'
          ? msToHHMM(durationEnd - new Date(openSession.enteredAt).getTime())
          : '00:00',
        latitude: latestSample.latitude,
        longitude: latestSample.longitude,
        speed: latestSample.speed,
        ignition: latestSample.ignition,
        provider: latestSample.provider,
        lastSyncType: latestSample.syncType || null,
        rawTelemetry: latestSample.rawTelemetry,
        providerUnavailable: providerHealthByName.get('WheelsEye GPS') &&
          providerHealthByName.get('WheelsEye GPS').connectionStatus !== 'Connected'
          ? { provider: 'WheelsEye GPS', lastSuccessAt: providerHealthByName.get('WheelsEye GPS').lastSuccessAt || null }
          : null,
        providerLocations: [],
        locationDiscrepancyMeters: null,
      });
    }
  }

  const widgetFleet = dashboardOnly ? fleet.filter(isDashboardEligibleGpsVehicle) : fleet;
  const plantWidgets = plants.map((plant) => ({
    id: plant._id,
    name: plant.plantName,
    location: plant.location,
    radiusMeter: getPlantRadiusMeters(plant),
    latitude: plant.latitude,
    longitude: plant.longitude,
    vehicles: widgetFleet.filter((item) => item.status === 'Inside' && item.plant?.id?.toString() === plant._id.toString()),
  }));
  const outsideVehicles = widgetFleet.filter((item) => item.status === 'Outside');

  return {
    plants,
    fleet: widgetFleet,
    plantWidgets,
    outsideVehicles,
    totalActiveVehicles: widgetFleet.filter((item) =>
      item.providerLocations?.some((location) => location.hasGps)
    ).length,
    lastUpdated: widgetFleet.reduce((latest, item) => (
      item.gpsTimestamp && (!latest || item.gpsTimestamp > latest) ? item.gpsTimestamp : latest
    ), null),
    providerHealth: gpsSettings.map((setting) => ({
      provider: setting.provider,
      active: setting.status === 'Active',
      status: setting.connectionStatus,
      lastSuccessAt: setting.lastSuccessAt,
      lastErrorAt: setting.lastErrorAt,
      lastErrorCode: setting.lastErrorCode,
      consecutiveFailures: setting.consecutiveFailures,
    })),
  };
}

async function rebuildPlantStays(vehicleId) {
  const vehicle = await Vehicle.findById(vehicleId);
  if (!vehicle) return;
  const [samples, plants] = await Promise.all([
    GpsHistory.find({ vehicleId, provider: /wheels.?eye/i, archived: { $ne: true } })
      .sort({ gpsTimestamp: 1, syncTime: 1 }),
    Plant.find({ status: 'Active' }),
  ]);
  const points = uniqueChronologicalSamples(samples.filter(isVerifiedGpsSample), plants).map((point) => ({
    ...point,
    plantName: point.status === 'DASNA' ? 'DASNA' : point.status,
  }));
  const stays = [];
  let current = null;
  for (const point of points) {
    const isPlant = point.status !== 'Outside' && point.status !== 'No GPS Data';
    const gap = current ? point.time.getTime() - current.lastGpsTimestamp.getTime() : 0;
    if (
      current &&
      (!isPlant || point.status !== current.plantName || gap > MAX_GPS_GAP_MS)
    ) {
      stays.push({
        ...current,
        exitGpsTimestamp: gap > MAX_GPS_GAP_MS
          ? new Date(current.lastGpsTimestamp.getTime() + MAX_GPS_GAP_MS)
          : point.time,
        isCurrent: false,
      });
      current = null;
    }
    if (isPlant) {
      if (!current) {
        current = {
          vehicleId,
          vehicleNumber: vehicle.vehicleNumber,
          vehicleNumberNormalized: normalizeVehicleNumber(vehicle.vehicleNumber),
          plantName: point.plantName,
          entryGpsTimestamp: point.time,
          lastGpsTimestamp: point.time,
          isCurrent: false,
        };
      } else {
        current.lastGpsTimestamp = point.time;
      }
    }
  }
  if (current) stays.push({ ...current, exitGpsTimestamp: null, isCurrent: true });

  await PlantStay.deleteMany({ vehicleId });
  if (stays.length) await PlantStay.insertMany(stays, { ordered: true });
}

module.exports = {
  STALE_THRESHOLD_MS,
  isDashboardEligibleGpsVehicle,
  isVerifiedGpsSample,
  getFleetGpsSnapshot,
  rebuildPlantStays,
};
