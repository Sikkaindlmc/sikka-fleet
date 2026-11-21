const { calculateHaversineDistance, getPlantRadiusMeters } = require('./geofenceService');

function isReadableProviderAddress(address) {
  if (typeof address !== 'string') return false;
  const value = address.trim();
  if (!value || /^(outside|n\/?a|unknown|no gps location|location unavailable)$/i.test(value)) return false;
  if (/^en route\s*\(/i.test(value) || /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(value)) return false;
  return /[a-z\u0900-\u097f]/i.test(value);
}

/**
 * Returns a clean, human-readable address/location representation for coordinates.
 * When no address is available, show the nearest plant distance without exposing coordinates.
 */
function getReadableLocation(latitude, longitude, plants = []) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return 'Location Unavailable';
  }

  let nearestPlant = null;
  let minDistance = Infinity;

  if (Array.isArray(plants) && plants.length > 0) {
    for (const p of plants) {
      if (typeof p.latitude === 'number' && typeof p.longitude === 'number') {
        const dist = calculateHaversineDistance(latitude, longitude, p.latitude, p.longitude);
        if (dist < minDistance) {
          minDistance = dist;
          nearestPlant = p;
        }
      }
    }
  }

  if (nearestPlant) {
    const radius = getPlantRadiusMeters(nearestPlant);
    if (radius !== null && minDistance <= radius) {
      return nearestPlant.plantName;
    }
    const km = (minDistance / 1000).toFixed(1);
    return `About ${km} km from ${nearestPlant.plantName}`;
  }

  return 'Location unavailable';
}

module.exports = {
  getReadableLocation,
  isReadableProviderAddress,
};
