const Vehicle = require('../models/Vehicle');
const Plant = require('../models/Plant');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const GpsSetting = require('../models/GpsSetting');
const { fetchWheelsEyeTelemetry } = require('./gpsSyncService');

/**
 * Fetch vehicle coordinates from the configured WheelsEye GPS service.
 * Reads real-time telemetry from providers.
 * NEVER generates fake or simulated random coordinates.
 * If external GPS fails or is unavailable, falls back to the last known verified
 * database status in VehicleCurrentStatus; fallback values remain explicitly stale.
 */
async function fetchGpsLocations(gpsConfig) {
  try {
    let settings = [];
    if (gpsConfig && gpsConfig.apiUrl && !gpsConfig.apiUrl.includes('••••')) {
      settings = [gpsConfig];
    } else {
      settings = await GpsSetting.find({
        status: 'Active',
        provider: /wheels.?eye/i,
        archived: { $ne: true },
      });
    }

    const telemetry = await fetchWheelsEyeTelemetry(settings);
    if (telemetry && telemetry.vehicles && telemetry.vehicles.length > 0) {
      return telemetry.vehicles.map((v) => ({
        vehicleNumber: v.vehicleNumber,
        latitude: v.latitude,
        longitude: v.longitude,
        speed: v.speed,
        ignition: v.ignition,
        deviceNumber: v.deviceNumber || 'N/A',
        vendorName: v.vendorName || 'WheelsEye GPS',
        vehicleType: v.vehicleType || 'Commercial',
        angle: v.angle || 0,
        chargeOn: v.chargeOn,
        timestamp: v.timestamp || null,
        readableTime: v.timestamp ? new Date(v.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
        address: v.address || '',
        provider: v.provider || 'WheelsEye GPS',
        gps_status: v.timestamp && Date.now() - new Date(v.timestamp).getTime() <= 60 * 60 * 1000
          ? 'LIVE'
          : 'GPS STALE',
      }));
    }
  } catch (error) {
    console.warn(`[GPS External API Warning] External GPS request failed (${error.message}). Loading last known GPS status.`);
  }

  // Fallback to real last known positions from VehicleCurrentStatus (never fake data)
  const fallbackStatuses = await VehicleCurrentStatus.find()
    .populate('vehicleId', 'vehicleNumber driverName mobile fleetType status');

  return fallbackStatuses
    .filter((st) => st.vehicleId && st.vehicleId.status === 'Active' && typeof st.latitude === 'number' && typeof st.longitude === 'number')
    .map((st) => ({
      vehicleNumber: st.vehicleId.vehicleNumber,
      latitude: st.latitude,
      longitude: st.longitude,
      speed: st.rawTelemetry ? st.speed : null,
      ignition: st.rawTelemetry ? st.ignition : null,
      deviceNumber: 'GPS-STORED',
      vendorName: 'WheelsEye GPS',
      vehicleType: st.vehicleId.fleetType || 'Commercial',
      angle: 0,
      chargeOn: null,
      timestamp: st.latest_gps_timestamp || null,
      readableTime: st.latest_gps_timestamp
        ? new Date(st.latest_gps_timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        : '',
      address: st.address || '',
      provider: st.provider || null,
      gps_status: 'GPS STALE',
    }));
}

module.exports = {
  fetchGpsLocations,
};
