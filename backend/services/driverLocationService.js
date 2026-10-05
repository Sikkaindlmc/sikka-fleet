const Plant = require('../models/Plant');
const Driver = require('../models/Driver');
const DriverPlantRecord = require('../models/DriverPlantRecord');
const DriverLocation = require('../models/DriverLocation');
const { calculateHaversineDistance } = require('./geofenceService');

// Define stale freshness threshold in milliseconds (25 minutes)
const STALE_THRESHOLD_MS = 25 * 60 * 1000;

/**
 * Calculates geodesic distance between two points in meters if not imported
 */
function getDistance(lat1, lon1, lat2, lon2) {
  if (typeof calculateHaversineDistance === 'function') {
    return calculateHaversineDistance(lat1, lon1, lat2, lon2);
  }
  const R = 6371000;
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
 * Evaluates driver device GPS coordinates against configured Plant geofences
 * and handles automatic Plant IN & Plant OUT records.
 *
 * @param {string|ObjectId} driverId - Verified Driver ID from JWT session (never trusted from body)
 * @param {number} latitude - Device GPS latitude
 * @param {number} longitude - Device GPS longitude
 * @param {number} accuracy - Optional GPS accuracy in meters
 * @param {Date} [timestamp=new Date()] - Capture timestamp
 */
async function processDriverLocation({ driverId, latitude, longitude, accuracy = null, timestamp = new Date() }) {
  if (!driverId) {
    throw new Error('Driver ID is required for location processing.');
  }

  const driver = await Driver.findById(driverId);
  if (!driver) {
    throw new Error('Driver not found.');
  }

  const now = new Date(timestamp || Date.now());

  // 1. Fetch all active plants
  const activePlants = await Plant.find({ status: 'Active' });

  let matchedPlant = null;
  let minDistance = Infinity;

  // 2. Compare coordinates against every active plant radius
  for (const plant of activePlants) {
    const radius = plant.radiusMeters || plant.radiusMeter || 500;
    const distance = getDistance(latitude, longitude, plant.latitude, plant.longitude);

    if (distance <= radius) {
      if (distance < minDistance) {
        minDistance = distance;
        matchedPlant = plant;
      }
    }
  }

  const wasInside = driver.currentStatus === 'Inside';
  const isNowInside = matchedPlant !== null;
  const previousPlantId = driver.currentPlantId ? driver.currentPlantId.toString() : null;
  const matchedPlantId = matchedPlant ? matchedPlant._id.toString() : null;

  // 3. CASE A: Driver is currently INSIDE a plant radius
  if (isNowInside) {
    // If entering plant for the first time OR changed from a different plant
    if (!wasInside || previousPlantId !== matchedPlantId) {
      // If was previously in another plant, complete that plant record
      if (wasInside && previousPlantId && previousPlantId !== matchedPlantId) {
        await DriverPlantRecord.updateMany(
          { driverId: driver._id, status: 'Inside' },
          {
            status: 'Completed',
            outTime: now,
            outLatitude: latitude,
            outLongitude: longitude,
            outDistanceMeters: minDistance,
          }
        );
      }

      // Automatically create new Plant IN record (Requirement 14)
      await DriverPlantRecord.create({
        driverId: driver._id,
        driverName: driver.driverName,
        dlNumber: driver.dlNumber,
        plantId: matchedPlant._id,
        plantName: matchedPlant.plantName,
        status: 'Inside',
        inTime: now,
        inLatitude: latitude,
        inLongitude: longitude,
        inDistanceMeters: minDistance,
        lastCheckedAt: now,
      });

      driver.currentStatus = 'Inside';
      driver.currentPlantId = matchedPlant._id;
      driver.currentPlantName = matchedPlant.plantName;
      driver.currentPlantInTime = now;
    } else {
      // Still inside the same plant - update last checked timestamp on ongoing record
      await DriverPlantRecord.updateOne(
        { driverId: driver._id, plantId: matchedPlant._id, status: 'Inside' },
        { lastCheckedAt: now }
      );
    }
  }
  // 4. CASE B: Driver is OUTSIDE all configured plant radii (Requirement 15)
  else {
    // If driver was previously inside a plant, automatically mark Plant OUT
    if (wasInside) {
      await DriverPlantRecord.updateMany(
        { driverId: driver._id, status: 'Inside' },
        {
          status: 'Completed',
          outTime: now,
          outLatitude: latitude,
          outLongitude: longitude,
          outDistanceMeters: null,
          lastCheckedAt: now,
        }
      );

      driver.currentStatus = 'Outside';
      driver.lastPlantOutTime = now;
      driver.currentPlantId = null;
      driver.currentPlantName = null;
    } else {
      driver.currentStatus = 'Outside';
    }
  }

  // 5. Update latest driver location and freshness timestamp
  driver.lastLocation = {
    latitude,
    longitude,
    accuracy,
    capturedAt: now,
  };
  driver.lastLocationUpdateAt = now;

  await driver.save();

  // 6. Automatically log immutable 20-minute location record
  try {
    await DriverLocation.create({
      driverId: driver._id,
      driverName: driver.driverName,
      dlNumber: driver.dlNumber,
      mobileNumber: driver.mobileNumber,
      latitude,
      longitude,
      accuracy,
      currentStatus: driver.currentStatus,
      plantId: driver.currentPlantId,
      plantName: driver.currentPlantName,
      distanceToPlantMeters: isNowInside ? minDistance : null,
      capturedAt: now,
    });
  } catch (logErr) {
    console.warn('[DriverLocation Log Error]:', logErr.message);
  }

  return getDriverLocationSummary(driver);
}

/**
 * Compiles a sanitized, driver-specific status summary.
 * Strictly guarantees ZERO data leakage of other drivers or vehicles.
 */
async function getDriverLocationSummary(driverDoc) {
  const driver = typeof driverDoc.toObject === 'function' ? driverDoc.toObject() : driverDoc;

  const now = Date.now();
  const lastUpdate = driver.lastLocationUpdateAt ? new Date(driver.lastLocationUpdateAt).getTime() : null;
  const isStale = !lastUpdate || (now - lastUpdate) > STALE_THRESHOLD_MS;

  // Retrieve current active plant entry or latest completed entry
  let activeRecord = null;
  if (driver.currentStatus === 'Inside' && driver.currentPlantId) {
    activeRecord = await DriverPlantRecord.findOne({
      driverId: driver._id,
      plantId: driver.currentPlantId,
      status: 'Inside',
    }).sort({ inTime: -1 });
  }

  // Retrieve last completed plant record for OUT timestamp if outside
  let lastCompletedRecord = null;
  if (driver.currentStatus === 'Outside') {
    lastCompletedRecord = await DriverPlantRecord.findOne({
      driverId: driver._id,
      status: 'Completed',
    }).sort({ outTime: -1 });
  }

  // Fetch plant metadata if inside
  let plantDetails = null;
  if (driver.currentPlantId) {
    const plant = await Plant.findById(driver.currentPlantId).select('plantName location radiusMeters radiusMeter latitude longitude');
    if (plant) {
      plantDetails = {
        id: plant._id,
        name: plant.plantName,
        location: plant.location,
        radiusMeters: plant.radiusMeters || plant.radiusMeter || 500,
        latitude: plant.latitude,
        longitude: plant.longitude,
      };
    }
  }

  return {
    driver: {
      id: driver._id,
      driverName: driver.driverName,
      dlNumber: driver.dlNumber,
      mobileNumber: driver.mobileNumber,
      status: driver.status,
    },
    currentStatus: driver.currentStatus || 'Outside',
    isInside: driver.currentStatus === 'Inside',
    isOutside: driver.currentStatus !== 'Inside',
    currentPlant: plantDetails || (driver.currentPlantName ? { name: driver.currentPlantName } : null),
    inTime: activeRecord ? activeRecord.inTime : driver.currentPlantInTime,
    outTime: lastCompletedRecord ? lastCompletedRecord.outTime : driver.lastPlantOutTime,
    lastLocation: driver.lastLocation || null,
    lastLocationUpdateAt: driver.lastLocationUpdateAt || null,
    isStale,
    staleThresholdMinutes: 25,
    refreshIntervalMinutes: 20,
    serverTime: new Date(),
  };
}

module.exports = {
  processDriverLocation,
  getDriverLocationSummary,
  STALE_THRESHOLD_MS,
};
