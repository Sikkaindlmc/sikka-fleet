const Plant = require('../models/Plant');
const Vehicle = require('../models/Vehicle');
const PlantEntry = require('../models/PlantEntry');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const VehicleLocation = require('../models/VehicleLocation');

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
 * Evaluates a vehicle's GPS position against all active plant geofences
 * and updates vehicleCurrentStatus and plantEntries accordingly.
 * 
 * Rules & Logic:
 * - Entry Date & Time: The timestamp when the vehicle first entered the plant.
 *   Preserved without change while the vehicle remains continuously inside the plant.
 * - Last Update Date & Time: The timestamp of the last system auto-sync or user manual GPS sync.
 */
async function processVehicleLocation(
  vehicle,
  latitude,
  longitude,
  deviceTimestamp = new Date(),
  source = 'GPS Provider',
  syncTime = new Date()
) {
  const vehicleId = vehicle._id;
  const vehicleNumber = vehicle.vehicleNumber;

  // 1. Save location history
  await VehicleLocation.create({
    vehicleId,
    vehicleNumber,
    latitude,
    longitude,
    gpsDateTime: deviceTimestamp,
    receivedAt: syncTime,
    source,
  });

  // 2. Query only Active plants
  const activePlants = await Plant.find({ status: 'Active' });

  let matchedPlant = null;
  let minDistance = Infinity;

  // 3. Compare coordinates against every active plant
  for (const plant of activePlants) {
    const radius = plant.radiusMeters || plant.radiusMeter || 500;
    const distance = calculateHaversineDistance(latitude, longitude, plant.latitude, plant.longitude);

    if (distance <= radius) {
      // Pick nearest active plant if overlapping
      if (distance < minDistance) {
        minDistance = distance;
        matchedPlant = plant;
      }
    }
  }

  // 4. Retrieve existing vehicleCurrentStatus
  let currentStatus = await VehicleCurrentStatus.findOne({ vehicleId });

  const isNowInside = matchedPlant !== null;
  const newStatus = isNowInside ? 'Inside' : 'Outside';
  const newPlantId = matchedPlant ? matchedPlant._id : null;
  const newDistance = isNowInside ? minDistance : null;

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
      entryDateTime = deviceTimestamp || syncTime;

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
        entryDateTime = lastEntry ? lastEntry.entryDateTime : (deviceTimestamp || syncTime);
      }
    }
  } else {
    // If vehicle was previously inside a plant, record the exit plant and timestamp
    if (currentStatus && currentStatus.status === 'Inside' && currentStatus.currentPlantId) {
      const prevPlant = await Plant.findById(currentStatus.currentPlantId);
      if (prevPlant) {
        currentStatus.lastExitPlantName = prevPlant.plantName;
      }
      currentStatus.lastExitDateTime = syncTime;
    }
    entryDateTime = null;
  }

  // 5. Update or create current status
  // lastEntryDateTime: when vehicle first entered this plant
  // lastUpdatedAt: when system auto-sync or manual sync GPS ran
  if (currentStatus) {
    currentStatus.currentPlantId = newPlantId;
    currentStatus.status = newStatus;
    currentStatus.latitude = latitude;
    currentStatus.longitude = longitude;
    currentStatus.distanceMeter = newDistance;
    currentStatus.lastEntryDateTime = entryDateTime;
    currentStatus.lastUpdatedAt = syncTime;
    await currentStatus.save();
  } else {
    currentStatus = await VehicleCurrentStatus.create({
      vehicleId,
      currentPlantId: newPlantId,
      status: newStatus,
      latitude,
      longitude,
      distanceMeter: newDistance,
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
};
