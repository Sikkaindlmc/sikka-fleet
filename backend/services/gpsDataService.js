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
const { getAssignedGpsProvider, getGpsConnectionStatus } = require('../utils/gpsProvider');
const {
  MAX_GPS_GAP_MS,
  normalizeVehicleNumber,
  classifyGpsSample,
  uniqueChronologicalSamples,
  latestStayBounds,
} = require('./gpsTimelineService');

const ZONE_PLANT_IDS = { DASNA: 'DASNA', SALT: 'Salt Plant', TEA: 'Tea Plant' };
const DEFAULT_GPS_PROVIDER = 'WheelsEye GPS';

function normalizeGpsProvider(provider) {
  const value = String(provider || '').trim();
  if (/fleetx|fleet/i.test(value)) return 'FleetX';
  if (/wheels.?eye/i.test(value)) return DEFAULT_GPS_PROVIDER;
  return value || DEFAULT_GPS_PROVIDER;
}

function providerKey(vehicleId, provider) {
  return `${vehicleId}:${normalizeGpsProvider(provider)}`;
}

function latestProviderSample(samples) {
  return samples.reduce((latest, sample) => {
    if (!latest) return sample;
    const sampleTime = new Date(sample.gpsTimestamp).getTime();
    const latestTime = new Date(latest.gpsTimestamp).getTime();
    if (sampleTime > latestTime) return sample;
    if (sampleTime === latestTime &&
        new Date(sample.syncTime || 0).getTime() > new Date(latest.syncTime || 0).getTime()) {
      return sample;
    }
    return latest;
  }, null);
}

function buildStatusSample(vehicle, status, provider) {
  if (!status?.latest_gps_timestamp ||
      !Number.isFinite(status.latitude) ||
      !Number.isFinite(status.longitude)) {
    return null;
  }
  return {
    vehicleId: vehicle._id,
    vehicleNumber: vehicle.vehicleNumber,
    latitude: status.latitude,
    longitude: status.longitude,
    gpsTimestamp: status.latest_gps_timestamp,
    syncTime: status.last_successful_sync_at || status.lastUpdatedAt,
    speed: status.speed,
    ignition: status.ignition,
    movementStatus: status.movementStatus,
    provider,
    rawTelemetry: status.rawTelemetry,
    syncType: status.lastSyncType || status.last_sync_source || null,
  };
}

function getSampleMovementStatus(sample) {
  const rawStatus = String(sample.movementStatus || sample.rawTelemetry?.movementStatus || '').toLowerCase();
  if (/not\s+moving|stopped|idle|parked/.test(rawStatus)) return 'Stopped';
  if (/moving|running|driving/.test(rawStatus)) return 'Moving';
  if (sample.speed === null || sample.speed === undefined || sample.speed === '') return null;
  const speed = Number(sample.speed);
  return Number.isFinite(speed) ? (speed > 0 ? 'Moving' : 'Stopped') : null;
}

function isDashboardEligibleGpsVehicle(item) {
  return Boolean(item?.isRegistered === true &&
    item.vehicle?.status === 'Active' &&
    (item.hasGps === true || item.providerLocations?.some((location) => location.hasGps)));
}

function getProviderConnectionStatus(health, provider) {
  return getGpsConnectionStatus(health, provider);
}

function buildProviderLocation(provider, sample, session, plants, now, health) {
  const connectionStatus = getProviderConnectionStatus(health, provider);
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
      speed: null,
      ignition: null,
      movementStatus: null,
      deviceNumber: null,
      angle: null,
      rawTelemetry: null,
      connectionStatus,
      lastSuccessfulSyncAt: health?.lastSuccessAt || health?.lastSync || null,
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
    connectionStatus === 'Connected' &&
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
    movementStatus: getSampleMovementStatus(sample),
    deviceNumber: sample.deviceNumber || sample.rawTelemetry?.deviceNumber || null,
    angle: sample.angle ?? sample.rawTelemetry?.angle ?? null,
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
    connectionStatus,
    lastSuccessfulSyncAt: health?.lastSuccessAt || health?.lastSync || null,
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
  const [vehicles, plants, statuses, openSessions, gpsSettings] = await Promise.all([
    Vehicle.find({ status: 'Active' }).sort({ vehicleNumber: 1 }),
    Plant.find({ status: 'Active' }).sort({ plantName: 1 }),
    VehicleCurrentStatus.find({ archived: { $ne: true } }),
    ZoneSession.find({ exitedAt: null, archived: { $ne: true } }),
    GpsSetting.find({ archived: { $ne: true } })
      .select('provider apiUrl status connectionStatus lastSync lastSuccessAt lastConnectionCheckAt lastErrorAt lastErrorCode lastError consecutiveFailures'),
  ]);
  const history = await GpsHistory.find({
    archived: { $ne: true },
  }).sort({ gpsTimestamp: 1, syncTime: 1 });
  const byVehicleId = new Map();
  const byVehicleNumber = new Map();
  for (const point of history) {
    const numberKey = normalizeVehicleNumber(point.vehicleNumberNormalized || point.vehicleNumber);
    if (!isVerifiedGpsSample(point)) continue;
    if (point.vehicleId) {
      const key = point.vehicleId.toString();
      if (!byVehicleId.has(key)) byVehicleId.set(key, []);
      byVehicleId.get(key).push(point);
    }
    if (!byVehicleNumber.has(numberKey)) byVehicleNumber.set(numberKey, []);
    byVehicleNumber.get(numberKey).push(point);
  }
  const statusesByVehicleId = new Map();
  const statusByVehicleProvider = new Map();
  for (const status of statuses) {
    const vehicleId = status.vehicleId?.toString();
    if (!vehicleId) continue;
    const provider = normalizeGpsProvider(status.provider);
    if (!statusesByVehicleId.has(vehicleId)) statusesByVehicleId.set(vehicleId, []);
    statusesByVehicleId.get(vehicleId).push(status);
    statusByVehicleProvider.set(providerKey(vehicleId, provider), status);
  }
  const sessionByVehicleProvider = new Map();
  const sessionByNumberProvider = new Map();
  for (const session of openSessions) {
    const provider = normalizeGpsProvider(session.provider);
    if (session.vehicleId) {
      sessionByVehicleProvider.set(providerKey(session.vehicleId.toString(), provider), session);
    }
    sessionByNumberProvider.set(
      `${normalizeVehicleNumber(session.vehicleNumberNormalized || session.vehicleNumber)}:${provider}`,
      session
    );
  }
  const providerHealthByName = new Map(gpsSettings.map((setting) => [
    normalizeGpsProvider(setting.provider || setting.apiUrl),
    setting,
  ]));

  const fleet = vehicles.map((vehicle) => {
    const vehicleNumberNormalized = normalizeVehicleNumber(vehicle.vehicleNumber);
    const vehicleId = vehicle._id.toString();
    const sampleMap = new Map();
    for (const sample of [
      ...(byVehicleId.get(vehicleId) || []),
      ...(byVehicleNumber.get(vehicleNumberNormalized) || []),
    ]) {
      const sampleId = sample._id?.toString() ||
        `${normalizeGpsProvider(sample.provider)}:${sample.gpsTimestamp}:${sample.latitude}:${sample.longitude}`;
      if (!sampleMap.has(sampleId)) sampleMap.set(sampleId, sample);
    }
    const assignedProvider = getAssignedGpsProvider(vehicle) === 'fleetx' ? 'FleetX' : DEFAULT_GPS_PROVIDER;
    const vehicleSamples = [...sampleMap.values()].filter(
      (sample) => normalizeGpsProvider(sample.provider) === assignedProvider
    );
    const vehicleStatuses = (statusesByVehicleId.get(vehicleId) || []).filter(
      (status) => normalizeGpsProvider(status.provider) === assignedProvider
    );
    const providerNames = new Set([assignedProvider]);

    let latestSample = latestProviderSample(vehicleSamples);
    let sampleProvider = latestSample ? normalizeGpsProvider(latestSample.provider) : null;
    let storedStatus = sampleProvider
      ? statusByVehicleProvider.get(providerKey(vehicleId, sampleProvider))
      : null;
    if (!latestSample) {
      const fallbackStatus = vehicleStatuses
        .filter((status) =>
          status.latest_gps_timestamp &&
          Number.isFinite(status.latitude) &&
          Number.isFinite(status.longitude)
        )
        .sort((a, b) =>
          new Date(b.latest_gps_timestamp).getTime() - new Date(a.latest_gps_timestamp).getTime()
        )[0];
      if (fallbackStatus) {
        sampleProvider = normalizeGpsProvider(fallbackStatus.provider);
        storedStatus = fallbackStatus;
        latestSample = buildStatusSample(vehicle, fallbackStatus, sampleProvider);
      }
    }

    if (sampleProvider) providerNames.add(sampleProvider);
    const providerLocations = [...providerNames].map((provider) => {
      const providerSamples = vehicleSamples.filter(
        (sample) => normalizeGpsProvider(sample.provider) === provider
      );
      const providerStatus = statusByVehicleProvider.get(providerKey(vehicleId, provider));
      const providerSample = latestProviderSample(providerSamples) ||
        buildStatusSample(vehicle, providerStatus, provider);
      const session = sessionByVehicleProvider.get(providerKey(vehicleId, provider)) ||
        sessionByNumberProvider.get(`${vehicleNumberNormalized}:${provider}`);
      return buildProviderLocation(
        provider,
        providerSample,
        session,
        plants,
        now,
        providerHealthByName.get(provider)
      );
    });

    const samples = sampleProvider
      ? vehicleSamples.filter((sample) => normalizeGpsProvider(sample.provider) === sampleProvider)
      : vehicleSamples;
    const openSession = sampleProvider
      ? sessionByVehicleProvider.get(providerKey(vehicleId, sampleProvider)) ||
        sessionByNumberProvider.get(`${vehicleNumberNormalized}:${sampleProvider}`)
      : null;
    if (!latestSample) {
      const unavailableProvider = [...providerNames].find((provider) => {
        const health = providerHealthByName.get(provider);
        return health && health.connectionStatus !== 'Connected';
      });
      const unavailableHealth = unavailableProvider
        ? providerHealthByName.get(unavailableProvider)
        : null;
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
        providerUnavailable: unavailableProvider
          ? { provider: unavailableProvider, lastSuccessAt: unavailableHealth.lastSuccessAt || null }
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
    const sampleProviderHealth = providerHealthByName.get(sampleProvider);
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
