const Plant = require('../models/Plant');
const Vehicle = require('../models/Vehicle');
const PlantEntry = require('../models/PlantEntry');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const VehicleLocation = require('../models/VehicleLocation');

const STALE_THRESHOLD_MS = Math.max(
  1,
  Number(process.env.GPS_STALE_THRESHOLD_MINUTES || 60)
) * 60 * 1000;

/**
 * Calculates geodesic distance between two points in meters using the Haversine formula.
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (angle) => (angle * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Converts milliseconds to "HH:mm" formatted string.
 */
function msToHHMM(ms) {
  if (!ms || ms <= 0) return '00:00';
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getPlantRadiusMeters(plant) {
  const radius = Number(plant?.radiusMeters ?? plant?.radiusMeter);
  return Number.isFinite(radius) && radius > 0 ? radius : null;
}

/**
 * Calculates duration strictly between the entry and latest vendor GPS timestamps.
 */
function calculateStayDuration(entryDateTime, gpsTimestamp) {
  if (!entryDateTime || !gpsTimestamp) return 'N/A';
  const entryMs = new Date(entryDateTime).getTime();
  const gpsMs = new Date(gpsTimestamp).getTime();
  if (isNaN(entryMs) || isNaN(gpsMs)) return 'N/A';

  const diffMs = Math.max(0, gpsMs - entryMs);
  return msToHHMM(diffMs);
}

/**
 * SINGLE SOURCE OF TRUTH: Evaluates vehicle GPS against all active plants.
 * Used by BOTH Dashboard and GPS page so the two can NEVER disagree.
 *
 * @param {Object} params
 * @param {number} params.latitude
 * @param {number} params.longitude
 * @param {Date|string} params.gpsTimestamp - Vendor GPS device time
 * @param {Date|string} [params.entryDateTime] - Time vehicle entered plant
 * @param {Array} activePlants - Array of active Plant documents
 * @param {Object} [options]
 * @returns {Object}
 */
function getVehiclePlantStatus({ latitude, longitude, gpsTimestamp, entryDateTime }, activePlants = [], options = {}) {
  const staleLimitMs = options.staleThresholdMs || STALE_THRESHOLD_MS;
  const now = options.now || new Date();

  const lat = typeof latitude === 'number' ? latitude : parseFloat(latitude);
  const lon = typeof longitude === 'number' ? longitude : parseFloat(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180 ||
      (lat === 0 && lon === 0)) {
    return {
      status: 'Outside',
      isInside: false,
      plantId: null,
      plantName: 'Outside All Plants',
      distanceMeter: null,
      nearestPlant: '',
      nearestDistance: null,
      gps_status: 'GPS DATA UNAVAILABLE',
      isStale: true,
      stayHours: 'N/A',
      gpsTimestamp: null,
    };
  }

  // 1. Freshness check based on vendor GPS timestamp
  const gpsDate = gpsTimestamp ? new Date(gpsTimestamp) : null;
  const hasValidGpsDate = gpsDate && !isNaN(gpsDate.getTime());
  const ageMs = hasValidGpsDate ? Math.max(0, now.getTime() - gpsDate.getTime()) : Infinity;
  const isStale = ageMs > staleLimitMs;
  let gps_status = 'LIVE';
  if (isStale) {
    gps_status = 'GPS STALE';
  } else if (ageMs > 15 * 60 * 1000) {
    gps_status = 'RECENT';
  }

  // 2. Geofence evaluation using Haversine distance
  let matchedPlant = null;
  let minDistance = Infinity;
  let nearestPlant = '';
  let nearestDistance = Infinity;

  for (const plant of activePlants) {
    if (
      !Number.isFinite(plant.latitude) ||
      !Number.isFinite(plant.longitude) ||
      plant.latitude < -90 ||
      plant.latitude > 90 ||
      plant.longitude < -180 ||
      plant.longitude > 180 ||
      (plant.latitude === 0 && plant.longitude === 0)
    ) continue;
    const radius = getPlantRadiusMeters(plant);
    if (radius === null) continue;
    const dist = calculateHaversineDistance(lat, lon, plant.latitude, plant.longitude);

    if (dist < nearestDistance) {
      nearestDistance = dist;
      nearestPlant = plant.plantName;
    }

    if (dist <= radius && dist < minDistance) {
      minDistance = dist;
      matchedPlant = plant;
    }
  }

  const isInside = matchedPlant !== null;
  const status = isInside ? 'Inside' : 'Outside';
  const plantId = matchedPlant ? matchedPlant._id : null;
  const plantName = matchedPlant ? matchedPlant.plantName : 'Outside All Plants';
  const distanceMeter = isInside ? minDistance : nearestDistance;

  // 3. Stay duration (frozen if stale)
  const stayHours = isInside
    ? calculateStayDuration(entryDateTime, gpsDate)
    : '00:00';

  return {
    status,
    isInside,
    plantId,
    plantName,
    distanceMeter,
    nearestPlant,
    nearestDistance,
    gps_status,
    isStale,
    stayHours,
    gpsTimestamp: gpsDate,
  };
}

/**
 * Evaluates a vehicle's GPS position against all active plant geofences
 * and updates vehicleCurrentStatus and plantEntries accordingly.
 * 
 * Rules & Logic:
 * - Entry Date & Time: The timestamp when the vehicle first entered the plant.
 *   Preserved without change while the vehicle remains continuously inside the plant.
 * - Last Update Date & Time: The timestamp of the last scheduled or on-demand provider GPS sync.
 */
async function processVehicleLocation(
  vehicle,
  latitude,
  longitude,
  deviceTimestamp,
  source = 'GPS Provider',
  syncTime = new Date()
) {
  const gpsDate = deviceTimestamp ? new Date(deviceTimestamp) : null;
  if (!gpsDate || Number.isNaN(gpsDate.getTime())) {
    throw new Error('A valid vendor GPS timestamp is required to process a vehicle location.');
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
    throw new Error('Valid vendor GPS coordinates are required to process a vehicle location.');
  }
  const vehicleId = vehicle._id;
  const vehicleNumber = vehicle.vehicleNumber;

  // 1. Save location history
  await VehicleLocation.create({
    vehicleId,
    vehicleNumber,
    latitude,
    longitude,
    gpsDateTime: gpsDate,
    receivedAt: syncTime,
    source,
  });

  // 2. Query only Active plants
  const activePlants = await Plant.find({ status: 'Active' });

  // 3. Retrieve current status and evaluate with the shared plant calculation.
  let currentStatus = await VehicleCurrentStatus.findOne({ vehicleId });
  const plantEval = getVehiclePlantStatus(
    {
      latitude,
      longitude,
      gpsTimestamp: gpsDate,
      entryDateTime: currentStatus?.lastEntryDateTime,
    },
    activePlants,
    { now: syncTime }
  );
  const matchedPlant = activePlants.find((plant) => plant._id.toString() === plantEval.plantId?.toString()) || null;

  const isNowInside = plantEval.isInside;
  const newStatus = isNowInside ? 'Inside' : 'Outside';
  const newPlantId = plantEval.plantId;
  const newDistance = isNowInside ? plantEval.distanceMeter : null;

  let entryEventRecorded = null;
  let entryDateTime = currentStatus ? currentStatus.lastEntryDateTime : null;

  if (isNowInside) {
    const wasOutside = !currentStatus || currentStatus.status === 'Outside' || !currentStatus.currentPlantId;
    const changedPlant =
      currentStatus &&
      currentStatus.currentPlantId &&
      currentStatus.currentPlantId.toString() !== newPlantId.toString();

    // Transition Rule: Only create a Plant Entry event when transitioning from Outside or another plant
    if (wasOutside || changedPlant) {
      // Vehicle first time IN this plant session
      entryDateTime = gpsDate;

      entryEventRecorded = await PlantEntry.create({
        vehicleId,
        vehicleNumber,
        plantId: newPlantId,
        plantName: matchedPlant.plantName,
        entryDateTime,
        latitude,
        longitude,
        distanceMeter: newDistance,
      });

      console.log(`[Plant Entry Event] ${vehicleNumber} entered ${matchedPlant.plantName} at ${new Date(entryDateTime).toISOString()}`);
    } else {
      // Vehicle was already inside this plant: Preserve initial entry time!
      if (!entryDateTime) {
        const lastEntry = await PlantEntry.findOne({ vehicleId, plantId: newPlantId }).sort({ entryDateTime: -1 });
        entryDateTime = lastEntry ? lastEntry.entryDateTime : gpsDate;
      }
    }
  } else {
    // If vehicle was previously inside a plant, record the exit plant and timestamp
    if (currentStatus && currentStatus.status === 'Inside' && currentStatus.currentPlantId) {
      const prevPlant = await Plant.findById(currentStatus.currentPlantId);
      if (prevPlant) {
        currentStatus.lastExitPlantName = prevPlant.plantName;
      }
      currentStatus.lastExitDateTime = gpsDate;
    }
    entryDateTime = null;
  }

  // 5. Update or create current status
  // lastEntryDateTime: when vehicle first entered this plant
  // lastUpdatedAt: when the scheduled or on-demand provider sync ran
  if (currentStatus) {
    currentStatus.currentPlantId = newPlantId;
    currentStatus.current_plant = matchedPlant ? matchedPlant.plantName : null;
    currentStatus.current_geofence = isNowInside ? 'INSIDE' : 'OUTSIDE';
    currentStatus.status = newStatus;
    currentStatus.latitude = latitude;
    currentStatus.longitude = longitude;
    currentStatus.distanceMeter = newDistance;
    currentStatus.lastEntryDateTime = entryDateTime;
    currentStatus.latest_gps_timestamp = gpsDate;
    currentStatus.last_successful_sync_at = syncTime;
    currentStatus.gps_status = plantEval.gps_status;
    currentStatus.provider = source;
    currentStatus.speed = null;
    currentStatus.ignition = null;
    currentStatus.movementStatus = null;
    currentStatus.rawTelemetry = null;
    currentStatus.lastUpdatedAt = syncTime;
    await currentStatus.save();
  } else {
    currentStatus = await VehicleCurrentStatus.create({
      vehicleId,
      currentPlantId: newPlantId,
      current_plant: matchedPlant ? matchedPlant.plantName : null,
      current_geofence: isNowInside ? 'INSIDE' : 'OUTSIDE',
      status: newStatus,
      latitude,
      longitude,
      distanceMeter: newDistance,
      latest_gps_timestamp: gpsDate,
      last_successful_sync_at: syncTime,
      gps_status: plantEval.gps_status,
      provider: source,
      speed: null,
      ignition: null,
      movementStatus: null,
      rawTelemetry: null,
      lastEntryDateTime: entryDateTime,
      lastUpdatedAt: syncTime,
    });
  }

  return {
    vehicleId,
    vehicleNumber,
    status: newStatus,
    plant: matchedPlant ? { id: matchedPlant._id, name: matchedPlant.plantName } : null,
    distanceMeter: newDistance,
    entryEventRecorded: !!entryEventRecorded,
  };
}

module.exports = {
  calculateHaversineDistance,
  processVehicleLocation,
  getVehiclePlantStatus,
  calculateStayDuration,
  msToHHMM,
  getPlantRadiusMeters,
  STALE_THRESHOLD_MS,
};
