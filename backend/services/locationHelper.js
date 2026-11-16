const { calculateHaversineDistance, getPlantRadiusMeters } = require('./geofenceService');

/**
 * Returns a clean, human-readable address/location representation for coordinates.
 * Requirement 24.9: Readable Location (e.g. "Near XYZ Road, Ghaziabad, Uttar Pradesh").
 */
function getReadableLocation(latitude, longitude, plants = []) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return 'Location Unavailable';
  }

  // Find nearest plant / industrial landmark if available
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

  // If very close to a known plant landmark
  if (nearestPlant) {
    const radius = getPlantRadiusMeters(nearestPlant);
    if (radius !== null && minDistance <= radius) {
      return nearestPlant.plantName;
    }
    if (minDistance < 1500) {
      const km = (minDistance / 1000).toFixed(1);
      return `${km} km from ${nearestPlant.plantName}, ${nearestPlant.location || 'Uttar Pradesh'}`;
    }
  }

  return `En Route (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
}

module.exports = {
  getReadableLocation,
};
