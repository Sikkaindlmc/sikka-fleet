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
 */
async function processVehicleLocation(vehicle, latitude, longitude, timestamp = new Date(), source = 'GPS Provider') {
  const vehicleId = vehicle._id;
  const vehicleNumber = vehicle.vehicleNumber;

  // 1. Save location history
  await VehicleLocation.create({
    vehicleId,
    vehicleNumber,
    latitude,
    longitude,
    gpsDateTime: timestamp,
    receivedAt: new Date(),
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
      entryDateTime = timestamp;

      entryEventRecorded = await PlantEntry.create({
        vehicleId,
        vehicleNumber,
        plantId: newPlantId,
        plantName: matchedPlant.plantName,
        entryDateTime: timestamp,
        latitude,
        longitude,
        distanceMeter: newDistance,
      });

      console.log(`[Plant Entry Event] ${vehicleNumber} entered ${matchedPlant.plantName} at ${timestamp.toISOString()}`);
    }
  } else {
    // If vehicle was previously inside a plant, record the exit plant and timestamp
    if (currentStatus && currentStatus.status === 'Inside' && currentStatus.currentPlantId) {
      const prevPlant = await Plant.findById(currentStatus.currentPlantId);
      if (prevPlant) {
        currentStatus.lastExitPlantName = prevPlant.plantName;
      }
      currentStatus.lastExitDateTime = timestamp;
    }
    entryDateTime = null;
  }

  // 5. Update or create current status
  if (currentStatus) {
    currentStatus.currentPlantId = newPlantId;
    currentStatus.status = newStatus;
    currentStatus.latitude = latitude;
    currentStatus.longitude = longitude;
    currentStatus.distanceMeter = newDistance;
    currentStatus.lastEntryDateTime = entryDateTime;
    currentStatus.lastUpdatedAt = timestamp;
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
      lastUpdatedAt: timestamp,
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
