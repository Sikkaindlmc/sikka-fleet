const Driver = require('../models/Driver');
const { calculateHaversineDistance } = require('./geofenceService');

// Maximum Driver Matching Radius = 100 Meters (Requirement 23.1)
const MAX_DRIVER_MATCH_RADIUS_METERS = 100;

// Maximum acceptable freshness window for GPS matching (45 minutes)
const DRIVER_GPS_FRESHNESS_MS = 45 * 60 * 1000;

/**
 * Calculates distance between two GPS coordinates in meters.
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
 * Fetches all Active drivers who have valid, recent GPS coordinates.
 */
async function getAvailableActiveDrivers() {
  const drivers = await Driver.find({ status: 'Active' });
  const now = Date.now();

  const available = [];
  for (const d of drivers) {
    const lat = d.lastLocation?.latitude ?? d.lastLoginLocation?.latitude;
    const lng = d.lastLocation?.longitude ?? d.lastLoginLocation?.longitude;
    const capturedAt = d.lastLocationUpdateAt ?? d.lastLocation?.capturedAt ?? d.lastLoginLocation?.capturedAt;

    if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
      // Verify GPS freshness (Requirement 23.7)
      const isFresh = capturedAt ? (now - new Date(capturedAt).getTime()) <= DRIVER_GPS_FRESHNESS_MS : false;

      available.push({
        id: d._id.toString(),
        driverName: d.driverName,
        dlNumber: d.dlNumber,
        mobileNumber: d.mobileNumber,
        latitude: lat,
        longitude: lng,
        capturedAt: capturedAt || null,
        isFresh,
      });
    }
  }

  return available;
}

/**
 * Finds all active drivers within 100 meters of a given vehicle/plant coordinate.
 *
 * @param {number} targetLat - Vehicle/Target latitude
 * @param {number} targetLng - Vehicle/Target longitude
 * @param {Array} [preloadedDrivers] - Optional list of active drivers to avoid multiple DB calls
 * @param {number} [maxRadius=100] - Proximity threshold in meters (default 100m)
 */
async function findNearestDriversForLocation(targetLat, targetLng, preloadedDrivers = null, maxRadius = MAX_DRIVER_MATCH_RADIUS_METERS) {
  if (typeof targetLat !== 'number' || typeof targetLng !== 'number' || isNaN(targetLat) || isNaN(targetLng)) {
    return {
      nearestDrivers: [],
      nearestDriver: null,
      count: 0,
      multipleDrivers: false,
      noDriver: true,
    };
  }

  const drivers = preloadedDrivers || (await getAvailableActiveDrivers());

  const matched = [];
  for (const driver of drivers) {
    const dist = getDistance(targetLat, targetLng, driver.latitude, driver.longitude);

    if (dist <= maxRadius) {
      matched.push({
        id: driver.id,
        driverName: driver.driverName,
        dlNumber: driver.dlNumber,
        mobileNumber: driver.mobileNumber,
        distanceMeters: Math.round(dist),
        lastLocationAt: driver.capturedAt,
      });
    }
  }

  // Sort nearest distance first (Requirement 23.3)
  matched.sort((a, b) => a.distanceMeters - b.distanceMeters);

  const count = matched.length;

  return {
    nearestDrivers: matched,
    nearestDriver: count > 0 ? matched[0] : null,
    count,
    multipleDrivers: count > 1,
    noDriver: count === 0,
  };
}

/**
 * Attaches nearest driver information to a list of vehicle objects based on GPS proximity.
 *
 * @param {Array} vehicles - Array of vehicles containing latitude & longitude
 */
async function attachNearestDriversToVehicles(vehicles) {
  if (!Array.isArray(vehicles) || vehicles.length === 0) {
    return vehicles;
  }

  const activeDrivers = await getAvailableActiveDrivers();

  return vehicles.map((v) => {
    const lat = typeof v.latitude === 'number' ? v.latitude : null;
    const lng = typeof v.longitude === 'number' ? v.longitude : null;

    if (lat === null || lng === null) {
      return {
        ...v,
        nearestDrivers: [],
        driverName: v.driverName || null,
        mobile: v.mobile || null,
        noDriver: true,
        multipleDrivers: false,
      };
    }

    const matched = [];
    for (const driver of activeDrivers) {
      const dist = getDistance(lat, lng, driver.latitude, driver.longitude);
      if (dist <= MAX_DRIVER_MATCH_RADIUS_METERS) {
        matched.push({
          id: driver.id,
          driverName: driver.driverName,
          dlNumber: driver.dlNumber,
          mobileNumber: driver.mobileNumber,
          distanceMeters: Math.round(dist),
          lastLocationAt: driver.capturedAt,
        });
      }
    }

    // Sort by nearest distance first
    matched.sort((a, b) => a.distanceMeters - b.distanceMeters);

    const count = matched.length;

    // Apply Display Logic (Requirements 23.2, 23.3, 23.10):
    // Case 1: Exactly 1 Driver within 100m -> Display Driver Name + Mobile directly
    if (count === 1) {
      return {
        ...v,
        nearestDrivers: matched,
        driverName: matched[0].driverName,
        mobile: matched[0].mobileNumber,
        driverDistance: matched[0].distanceMeters,
        multipleDrivers: false,
        noDriver: false,
      };
    }

    // Case 2: Multiple Drivers within 100m -> Display Multiple Available + View
    if (count > 1) {
      return {
        ...v,
        nearestDrivers: matched,
        driverName: 'Multiple Drivers Available',
        mobile: null,
        multipleDrivers: true,
        noDriver: false,
      };
    }

    // Case 3: No Driver within 100m -> Display No Driver Available Within 100 Meters
    return {
      ...v,
      nearestDrivers: [],
      driverName: null,
      mobile: null,
      driverDistance: null,
      multipleDrivers: false,
      noDriver: true,
    };
  });
}

module.exports = {
  MAX_DRIVER_MATCH_RADIUS_METERS,
  getAvailableActiveDrivers,
  findNearestDriversForLocation,
  attachNearestDriversToVehicles,
};
