const axios = require('axios');

const DEFAULT_WHEELSEYE_URL =
  process.env.WHEELSEYE_API_URL ||
  'https://api.wheelseye.com/currentLoc';

function getWheelseyeToken() {
  return [process.env.WHEELSEYE_ACCESS_TOKEN, process.env.WHEELSEYE_API_KEY]
    .map((value) => String(value || '').trim())
    .find(Boolean) || '';
}

function getWheelseyeUrl() {
  const configuredUrl = String(process.env.WHEELSEYE_API_URL || '').trim();
  const url = new URL(
    configuredUrl && !configuredUrl.includes('••••')
      ? configuredUrl
      : DEFAULT_WHEELSEYE_URL
  );
  const token = getWheelseyeToken();
  if (token) {
    for (const key of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token', 'key', 'secret']) {
      url.searchParams.delete(key);
    }
    url.searchParams.set('accessToken', token);
  }
  if (!url.searchParams.get('accessToken')) {
    const error = new Error('WheelsEye access token is not configured.');
    error.code = 'MISSING_ENV_WHEELSEYE_ACCESS_TOKEN';
    throw error;
  }
  return url.toString();
}

/**
 * Normalizes a raw WheelsEye vehicle telemetry object.
 */
function normalizeWheelseyeVehicle(item) {
  if (!item) return null;

  const lat = typeof item.latitude === 'number' ? item.latitude : parseFloat(item.latitude);
  const lon = typeof item.longitude === 'number' ? item.longitude : parseFloat(item.longitude);
  const speed = Number(item.speed) || 0;
  const isIgnitionOn = Boolean(item.ignition);

  let timestamp = null;
  const rawTs = item.dttimeInEpoch || item.createdDate || item.lastUpdatedAt;
  if (rawTs) {
    const num = Number(rawTs);
    if (!isNaN(num) && num > 0) {
      timestamp = new Date(num > 1e11 ? num : num * 1000);
    }
  }
  if (!timestamp || isNaN(timestamp.getTime())) {
    timestamp = new Date();
  }

  return {
    vehicleNumber: (item.vehicleNumber || '').trim().toUpperCase(),
    driverName: item.driverName ? item.driverName.trim() : '',
    latitude: isNaN(lat) ? null : lat,
    longitude: isNaN(lon) ? null : lon,
    speed,
    ignition: isIgnitionOn,
    ignitionStatus: isIgnitionOn ? 'ON' : 'OFF',
    deviceNumber: item.deviceNumber || '',
    vendorName: item.venndorName || item.vendorName || 'Vaibhav Sikka',
    provider: 'WHEELSEYE',
    vehicleType: item.vehicleType || 'Commercial',
    address: item.address || '',
    timestamp,
    readableTime: timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
    chargeOn: Boolean(item.chargeOn),
  };
}

/**
 * Fetches real-time telemetry for all vehicles from WheelsEye.
 */
async function fetchWheelseyeLiveTelemetry() {
  const url = getWheelseyeUrl();

  console.log(`[WheelsEye API] Fetching telemetry from WheelsEye...`);

  const response = await axios.get(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'SikkaFleet-GpsTelematics/2.0',
    },
    timeout: 15000,
  });

  const list =
    response.data?.data?.list ||
    response.data?.list ||
    (Array.isArray(response.data) ? response.data : []);

  return list.map(normalizeWheelseyeVehicle).filter(Boolean);
}

module.exports = {
  fetchWheelseyeLiveTelemetry,
  normalizeWheelseyeVehicle,
  DEFAULT_WHEELSEYE_URL,
  getWheelseyeUrl,
};
