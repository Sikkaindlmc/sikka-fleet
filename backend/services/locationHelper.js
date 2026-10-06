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
  if (nearestPlant) {
    const rad = nearestPlant.radiusMeters || nearestPlant.radiusMeter || 500;
    if (minDistance <= rad) {
      return nearestPlant.plantName;
    }
    if (minDistance < 1500) {
      const km = (minDistance / 1000).toFixed(1);
      return `${km} km from ${nearestPlant.plantName}, ${nearestPlant.location || 'Uttar Pradesh'}`;
    }
  }

  // Specific landmarks in Ghaziabad / NCR
  if (latitude >= 28.76 && latitude <= 28.79 && longitude >= 77.49 && longitude <= 77.52) {
    return 'Muradnagar, Uttar Pradesh';
  }
  if (latitude >= 28.63 && latitude <= 28.65 && longitude >= 77.40 && longitude <= 77.43) {
    return 'NH-24, Ghaziabad';
  }
  if (latitude >= 28.67 && latitude <= 28.70 && longitude >= 77.51 && longitude <= 77.54) {
    return 'Dasna, Ghaziabad';
  }
  if (latitude >= 28.65 && latitude <= 28.67 && longitude >= 77.43 && longitude <= 77.45) {
    return 'Ghaziabad';
  }
  if (latitude >= 28.72 && latitude <= 28.75 && longitude >= 77.55 && longitude <= 77.59) {
    return 'Modinagar, Uttar Pradesh';
  }
  if (latitude >= 28.51 && latitude <= 28.54 && longitude >= 77.58 && longitude <= 77.61) {
    return 'Sikandrabad Highway, Bulandshahr';
  }

  // Regional heuristic based on NCR / UP coordinates
  if (latitude >= 28.5 && latitude <= 28.8 && longitude >= 77.2 && longitude <= 77.6) {
    if (longitude > 77.45) {
      return `Meerut Road Corridor, Ghaziabad`;
    }
    if (latitude < 28.64) {
      return `Sector 62 / NH-24 Bypass, Noida`;
    }
    return `Site IV Industrial Corridor, Sahibabad`;
  }

  return `En Route (${latitude.toFixed(4)}°N, ${longitude.toFixed(4)}°E), Uttar Pradesh`;
}

module.exports = {
  getReadableLocation,
};
