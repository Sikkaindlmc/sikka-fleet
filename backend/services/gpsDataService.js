const Plant = require('../models/Plant');
const Vehicle = require('../models/Vehicle');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const GpsHistory = require('../models/GpsHistory');
const PlantStay = require('../models/PlantStay');
const { getVehiclePlantStatus, getPlantRadiusMeters, msToHHMM } = require('./geofenceService');
const {
  MAX_GPS_GAP_MS,
  normalizeVehicleNumber,
  classifyGpsSample,
  uniqueChronologicalSamples,
  latestStayBounds,
} = require('./gpsTimelineService');

const STALE_THRESHOLD_MS = Math.max(
  1,
  Number(process.env.GPS_STALE_THRESHOLD_MINUTES || 60)
) * 60 * 1000;

async function getFleetGpsSnapshot({ now = new Date() } = {}) {
  const [vehicles, plants, statuses] = await Promise.all([
    Vehicle.find().sort({ vehicleNumber: 1 }),
    Plant.find({ status: 'Active' }).sort({ plantName: 1 }),
    VehicleCurrentStatus.find(),
  ]);
  const history = await GpsHistory.find({
    vehicleId: { $in: vehicles.map((vehicle) => vehicle._id) },
  }).sort({ gpsTimestamp: 1, syncTime: 1 });
  const byVehicleId = new Map();
  for (const point of history) {
    const key = point.vehicleId.toString();
    if (!byVehicleId.has(key)) byVehicleId.set(key, []);
    byVehicleId.get(key).push(point);
  }
  const statusByVehicleId = new Map(statuses.map((status) => [status.vehicleId.toString(), status]));

  const fleet = vehicles.map((vehicle) => {
    const samples = byVehicleId.get(vehicle._id.toString()) || [];
    const chronological = uniqueChronologicalSamples(samples, plants);
    const latestPoint = chronological[chronological.length - 1];
    const latestSample = latestPoint
      ? samples
          .filter((sample) => new Date(sample.gpsTimestamp).getTime() === latestPoint.time.getTime())
          .sort((a, b) => new Date(b.syncTime).getTime() - new Date(a.syncTime).getTime())[0]
      : null;
    const storedStatus = statusByVehicleId.get(vehicle._id.toString());
    if (!latestSample) {
      return {
        vehicle,
        storedStatus,
        samples,
        hasGps: false,
        status: 'Outside',
        plant: null,
        gpsTimestamp: null,
        entryGpsTimestamp: null,
        outsideSince: null,
        isStale: true,
        gpsStatus: 'GPS STALE',
        stayHours: 'N/A',
        outsideHours: 'N/A',
        latitude: null,
        longitude: null,
        speed: null,
        ignition: null,
        provider: null,
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
    const status = evaluation.isInside ? evaluation.plantName : 'Outside';
    const bounds = latestStayBounds(
      samples,
      plants,
      classifyGpsSample(latestSample, plants),
      MAX_GPS_GAP_MS
    );
    const gpsTimestamp = new Date(latestSample.gpsTimestamp);
    const stayHours = bounds.entryGpsTimestamp
      ? msToHHMM(gpsTimestamp.getTime() - bounds.entryGpsTimestamp.getTime())
      : '00:00';
    const outsideHours = bounds.outsideSince
      ? msToHHMM(gpsTimestamp.getTime() - bounds.outsideSince.getTime())
      : '00:00';

    return {
      vehicle,
      storedStatus,
      samples,
      hasGps: true,
      status: evaluation.isInside ? 'Inside' : 'Outside',
      plant: evaluation.isInside
        ? { id: evaluation.plantId, name: evaluation.plantName }
        : null,
      plantName: evaluation.isInside ? evaluation.plantName : null,
      distanceMeter: evaluation.distanceMeter,
      gpsTimestamp,
      entryGpsTimestamp: bounds.entryGpsTimestamp,
      outsideSince: bounds.outsideSince,
      isStale: evaluation.isStale,
      gpsStatus: evaluation.gps_status,
      stayHours: evaluation.isInside ? stayHours : '00:00',
      outsideHours: evaluation.isInside ? '00:00' : outsideHours,
      latitude: latestSample.latitude,
      longitude: latestSample.longitude,
      speed: latestSample.speed,
      ignition: latestSample.ignition,
      provider: latestSample.provider,
      rawTelemetry: latestSample.rawTelemetry,
    };
  });

  const plantWidgets = plants.map((plant) => ({
    id: plant._id,
    name: plant.plantName,
    location: plant.location,
    radiusMeter: getPlantRadiusMeters(plant),
    latitude: plant.latitude,
    longitude: plant.longitude,
    vehicles: fleet.filter((item) => item.status === 'Inside' && item.plant?.id?.toString() === plant._id.toString()),
  }));
  const outsideVehicles = fleet.filter((item) => item.status === 'Outside');

  return {
    plants,
    fleet,
    plantWidgets,
    outsideVehicles,
    totalActiveVehicles: fleet.length,
    lastUpdated: fleet.reduce((latest, item) => (
      item.gpsTimestamp && (!latest || item.gpsTimestamp > latest) ? item.gpsTimestamp : latest
    ), null),
  };
}

async function rebuildPlantStays(vehicleId) {
  const vehicle = await Vehicle.findById(vehicleId);
  if (!vehicle) return;
  const [samples, plants] = await Promise.all([
    GpsHistory.find({ vehicleId }).sort({ gpsTimestamp: 1, syncTime: 1 }),
    Plant.find({ status: 'Active' }),
  ]);
  const points = uniqueChronologicalSamples(samples, plants).map((point) => ({
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
  getFleetGpsSnapshot,
  rebuildPlantStays,
};
