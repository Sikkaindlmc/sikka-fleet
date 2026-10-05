const Plant = require('../models/Plant');
const Driver = require('../models/Driver');
const DriverPlantRecord = require('../models/DriverPlantRecord');
const DriverLocation = require('../models/DriverLocation');
const { calculateHaversineDistance } = require('./geofenceService');

// 20-minute interval definitions
const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
const GRACE_PERIOD_MS = 60 * 1000; // 1-minute buffer for network latency
const STALE_THRESHOLD_MS = REFRESH_INTERVAL_MS + GRACE_PERIOD_MS; // 21 minutes

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
 * CRITICAL RULE: Only actual, successfully received GPS coordinates are saved.
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

  // Reject invalid, NaN, or 0,0 mock coordinates
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    isNaN(latitude) ||
    isNaN(longitude) ||
    (latitude === 0 && longitude === 0)
  ) {
    throw new Error('Valid, non-zero numeric GPS latitude and longitude coordinates are required.');
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

      // Automatically create new Plant IN record
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
  // 4. CASE B: Driver is OUTSIDE all configured plant radii
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

  // 5. Update latest driver location and successful deduction status
  driver.lastLocation = {
    latitude,
    longitude,
    accuracy,
    capturedAt: now,
  };
  driver.lastLocationUpdateAt = now;
  driver.locationDeductionStatus = 'Location Deducted';
  driver.lastLocationAttemptAt = now;
  driver.lastLocationError = null;

  await driver.save();

  // 6. Save valid immutable location record (Requirement 5)
  // Stores: Driver Name, Driver/User ID, Latitude, Longitude, Location Date & Time, Accuracy, Status: Location Deducted
  try {
    await DriverLocation.create({
      driverId: driver._id,
      driverName: driver.driverName,
      dlNumber: driver.dlNumber,
      mobileNumber: driver.mobileNumber,
      latitude,
      longitude,
      accuracy,
      status: 'Location Deducted',
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
 * Handles a failed 20-minute location fetch attempt.
 *
 * CRITICAL RULES (Requirements 2, 3, 4):
 * - If location fetch fails, DO NOT create or save any location record.
 * - Do NOT use previous location as the current location.
 * - Do NOT estimate or generate a false location.
 * - Mark status as "Location Not Deducted".
 */
async function recordDriverLocationFailure({ driverId, reason = 'GPS unavailable' }) {
  if (!driverId) {
    throw new Error('Driver ID is required.');
  }

  const driver = await Driver.findById(driverId);
  if (!driver) {
    throw new Error('Driver not found.');
  }

  const now = new Date();
  driver.locationDeductionStatus = 'Location Not Deducted';
  driver.lastLocationAttemptAt = now;
  driver.lastLocationError = reason;
  // STRICT: Do NOT touch driver.lastLocation, do NOT touch driver.lastLocationUpdateAt,
  // and do NOT call DriverLocation.create()!

  await driver.save();

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
  
  // A location deduction is valid ONLY if it occurred within the active 20-minute window (+ grace period)
  // and the last attempt succeeded.
  const isCurrent = lastUpdate && (now - lastUpdate) <= STALE_THRESHOLD_MS;
  const isLocationDeducted = driver.locationDeductionStatus === 'Location Deducted' && isCurrent;
  const locationDeductionStatus = isLocationDeducted ? 'Location Deducted' : 'Location Not Deducted';

  const isStale = !isCurrent;

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
    // Requirement 3: Only actual GPS coordinates ever returned, with their true capture timestamp
    lastLocation: driver.lastLocation || null,
    lastLocationUpdateAt: driver.lastLocationUpdateAt || null,
    // Requirements 4 & 5: Exact status strings
    locationDeductionStatus,
    isLocationDeducted,
    lastLocationAttemptAt: driver.lastLocationAttemptAt || null,
    lastLocationError: driver.lastLocationError || null,
    isStale,
    refreshIntervalMinutes: 20,
    serverTime: new Date(),
  };
}

module.exports = {
  processDriverLocation,
  recordDriverLocationFailure,
  getDriverLocationSummary,
  REFRESH_INTERVAL_MS,
  STALE_THRESHOLD_MS,
};
