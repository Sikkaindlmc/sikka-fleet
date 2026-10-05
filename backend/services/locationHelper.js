const { calculateHaversineDistance } = require('./geofenceService');

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
  if (nearestPlant && minDistance < 1500) {
    const km = (minDistance / 1000).toFixed(1);
    return minDistance < 200
      ? `At ${nearestPlant.plantName}, ${nearestPlant.location || 'Uttar Pradesh'}`
      : `${km} km from ${nearestPlant.plantName}, ${nearestPlant.location || 'Uttar Pradesh'}`;
  }

  // Regional heuristic based on NCR / UP coordinates
  if (latitude >= 28.5 && latitude <= 28.8 && longitude >= 77.2 && longitude <= 77.6) {
    if (longitude > 77.4) {
      return `Near Meerut Road Corridor, Ghaziabad, Uttar Pradesh`;
    }
    if (latitude < 28.64) {
      return `Near Sector 62 / NH-24 Bypass, Noida, Uttar Pradesh`;
    }
    return `Near Site IV Industrial Corridor, Sahibabad, Ghaziabad`;
  }

  return `En Route (${latitude.toFixed(4)}°N, ${longitude.toFixed(4)}°E), Uttar Pradesh`;
}

module.exports = {
  getReadableLocation,
};
