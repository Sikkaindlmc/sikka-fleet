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
 * Fetch vehicle coordinates from configured GPS provider.
 * If provider is external, calls the third-party endpoint; otherwise falls back to simulator.
 */
async function fetchGpsLocations(gpsConfig) {
  if (gpsConfig && gpsConfig.status === 'Active' && gpsConfig.apiUrl && !gpsConfig.apiUrl.includes('.local')) {
    try {
      const headers = {};
      if (gpsConfig.encryptedApiKey && !gpsConfig.apiUrl.includes('accessToken=')) {
        headers['Authorization'] = `Bearer ${gpsConfig.encryptedApiKey}`;
      }
      if (gpsConfig.apiSecret) {
        headers['X-Api-Secret'] = gpsConfig.apiSecret;
      }

      const response = await axios.get(gpsConfig.apiUrl, {
        headers,
        timeout: 10000,
      });

      // Parse WheelsEye telemetry timestamp with millisecond/second support
      const parseTelematicsTimestamp = (item) => {
        if (item.createdDate !== undefined && item.createdDate !== null) {
          const num = Number(item.createdDate);
          if (!isNaN(num) && num > 0) {
            const ms = num > 1e11 ? num : num * 1000;
            const d = new Date(ms);
            if (!isNaN(d.getTime())) return d;
          }
        }
        if (item.timestamp) {
          const d = new Date(item.timestamp);
          if (!isNaN(d.getTime())) return d;
        }
        if (item.dttime) {
          const d = new Date(item.dttime);
          if (!isNaN(d.getTime())) return d;
        }
        if (item.createdDateReadable) {
          const d = new Date(item.createdDateReadable);
          if (!isNaN(d.getTime())) return d;
        }
        return new Date();
      };

      // 1. WheelsEye format: { success: true, data: { totalCount: 21, list: [ ... ] } }
      if (response.data && response.data.data && Array.isArray(response.data.data.list)) {
        return response.data.data.list.map((item) => ({
          vehicleNumber: item.vehicleNumber?.trim().toUpperCase(),
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
          speed: item.speed || 0,
          ignition: Boolean(item.ignition),
          deviceNumber: item.deviceNumber,
          vendorName: item.venndorName || item.vendorName || 'Vaibhav Sikka',
          vehicleType: item.vehicleType || 'Commercial',
          angle: item.angle || 0,
          chargeOn: Boolean(item.chargeOn),
          timestamp: parseTelematicsTimestamp(item),
          readableTime: item.createdDateReadable || item.dttime,
        }));
      }

      // 2. Standard list format
      if (response.data && Array.isArray(response.data.list)) {
        return response.data.list.map((item) => ({
          vehicleNumber: item.vehicleNumber?.trim().toUpperCase(),
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
          speed: item.speed || 0,
          ignition: Boolean(item.ignition),
          deviceNumber: item.deviceNumber,
          vendorName: item.venndorName || item.vendorName,
          timestamp: parseTelematicsTimestamp(item),
        }));
      }

      // 3. Direct array of vehicles
      if (Array.isArray(response.data)) {
        return response.data.map((item) => ({
          ...item,
          timestamp: parseTelematicsTimestamp(item),
        }));
      }
      if (response.data && Array.isArray(response.data.vehicles)) {
        return response.data.vehicles.map((item) => ({
          ...item,
          timestamp: parseTelematicsTimestamp(item),
        }));
      }
    } catch (error) {
      console.warn(`[GPS External API Warning] External GPS request failed (${error.message}). Falling back to simulation.`);
    }
  }

  // Fallback / Built-in Telematics simulator
  return generateSimulatedLocations();
}

module.exports = {
  fetchGpsLocations,
  generateSimulatedLocations,
  vehicleSimStates,
};
