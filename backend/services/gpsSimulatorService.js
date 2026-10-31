const axios = require('axios');
const Vehicle = require('../models/Vehicle');
const Plant = require('../models/Plant');

/**
 * Built-in fleet simulation logic.
 * Generates realistic coordinates around plant locations and highways in Delhi NCR/UP.
 */

// Coordinate presets matching our seed plants
// Tea Plant (Noida Sector 62): 28.6280, 77.3670
// Salt Plant (Ghaziabad Meerut Road): 28.6820, 77.4420
// Ghaziabad Plant (Sahibabad Industrial Area): 28.6650, 77.3450

// Vehicle movements state in-memory to simulate smooth driving
const vehicleSimStates = new Map();

function getRandomOffset(radiusInMeters) {
  // ~111,320 meters per degree latitude
  const radiusInDegrees = radiusInMeters / 111320;
  const u = Math.random();
  const v = Math.random();
  const w = radiusInDegrees * Math.sqrt(u);
  const t = 2 * Math.PI * v;
  const dLat = w * Math.cos(t);
  const dLon = (w * Math.sin(t)) / Math.cos(28.6 * (Math.PI / 180));
  return { dLat, dLon };
}

/**
 * Generates simulated GPS locations for all active vehicles.
 * Distributes some inside Tea Plant, some inside Salt Plant, some in Ghaziabad, and some Outside.
 */
async function generateSimulatedLocations() {
  const vehicles = await Vehicle.find({ status: 'Active' });
  const plants = await Plant.find({ status: 'Active' });

  const locations = [];

  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    let simState = vehicleSimStates.get(v._id.toString());

    if (!simState) {
      // Determine initial zone for this vehicle based on index
      // e.g. 0 & 1 -> Tea Plant, 2 -> Salt Plant, 3 -> Ghaziabad Plant, 4 & 5 -> Outside
      const targetPlantIndex = i % (plants.length + 2); // +2 for Outside cases
      if (targetPlantIndex < plants.length) {
        const plant = plants[targetPlantIndex];
        // Generate within plant radius * 0.7 to guarantee inside
        const offset = getRandomOffset(plant.radiusMeter * 0.5);
        simState = {
          lat: plant.latitude + offset.dLat,
          lon: plant.longitude + offset.dLon,
          targetType: 'plant',
          plantId: plant._id,
        };
      } else {
        // Outside plant: e.g. on Delhi-Meerut Expressway or NH9 (outside any plant)
        simState = {
          lat: 28.5900 + (i * 0.015),
          lon: 77.3100 + (i * 0.012),
          targetType: 'outside',
        };
      }
      vehicleSimStates.set(v._id.toString(), simState);
    } else {
      // Small jitter/movement (5-15 meters)
      const jitter = getRandomOffset(15);
      simState.lat += jitter.dLat;
      simState.lon += jitter.dLon;
    }

    locations.push({
      vehicleId: v._id,
      vehicleNumber: v.vehicleNumber,
      latitude: parseFloat(simState.lat.toFixed(6)),
      longitude: parseFloat(simState.lon.toFixed(6)),
      speed: Math.floor(Math.random() * 45) + 15,
      timestamp: new Date(),
    });
  }

  return locations;
}

/**
 * Fetch vehicle coordinates from configured GPS providers (WheelsEye and Fleetx).
 * Merges real-time telemetry from all active providers; falls back to simulator on failure.
 */
async function fetchGpsLocations(gpsConfig) {
  try {
    const GpsSetting = require('../models/GpsSetting');
    const { fetchAllGpsTelemetry } = require('./gpsSyncService');

    let settings = [];
    if (gpsConfig && gpsConfig.apiUrl && !gpsConfig.apiUrl.includes('.local')) {
      settings = [gpsConfig];
    } else {
      settings = await GpsSetting.find({ status: 'Active' });
    }

    const telemetry = await fetchAllGpsTelemetry(settings);
    if (telemetry && telemetry.vehicles && telemetry.vehicles.length > 0) {
      return telemetry.vehicles.map((v) => ({
        vehicleNumber: v.vehicleNumber,
        latitude: v.latitude,
        longitude: v.longitude,
        speed: v.speed || 0,
        ignition: Boolean(v.ignition),
        deviceNumber: v.deviceNumber || 'N/A',
        vendorName: v.vendorName || (v.provider === 'Fleetx' ? 'Fleetx' : 'Vaibhav Sikka'),
        vehicleType: v.vehicleType || 'Commercial',
        angle: v.angle || 0,
        chargeOn: Boolean(v.chargeOn),
        timestamp: v.timestamp || new Date(),
        readableTime: v.timestamp ? v.timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
        address: v.address || '',
        provider: v.provider,
      }));
    }
  } catch (error) {
    console.warn(`[GPS External API Warning] External GPS request failed (${error.message}). Falling back to simulation.`);
  }

  // Fallback / Built-in Telematics simulator
  return generateSimulatedLocations();
}

module.exports = {
  fetchGpsLocations,
  generateSimulatedLocations,
  vehicleSimStates,
};
