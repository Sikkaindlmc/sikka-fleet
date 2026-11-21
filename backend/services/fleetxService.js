const axios = require('axios');
const FormData = require('form-data');

const DEFAULT_FLEETX_BASE_URL =
  process.env.FLEETX_API_BASE_URL ||
  process.env.FLEETX_BASE_URL ||
  'https://api.fleetx.io';
const DEFAULT_FLEETX_BASIC_AUTH = (process.env.FLEETX_BASIC_AUTH || '').trim();
const DEFAULT_FLEETX_USERNAME = (process.env.FLEETX_USERNAME || '').trim();
const DEFAULT_FLEETX_PASSWORD = (process.env.FLEETX_PASSWORD || '').trim();

let cachedToken = null;
let tokenExpiresAt = null;
let tokenLoginPromise = null;

function normalizeFleetxVehicleNumber(number) {
  let value = String(number || '').toUpperCase().trim();
  value = value.replace(/\s*[_-]\s*CAM(?:ERA)?$/i, '').trim();
  return value.replace(/[^A-Z0-9]/g, '');
}

function parseFleetxTimestamp(rawTimestamp) {
  if (rawTimestamp === undefined || rawTimestamp === null || rawTimestamp === '') return null;
  if (rawTimestamp instanceof Date) {
    return Number.isNaN(rawTimestamp.getTime()) ? null : rawTimestamp;
  }
  const numeric = Number(rawTimestamp);
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric > 1e11 ? numeric : numeric * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(String(rawTimestamp).trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Authenticates with FleetX Login API and returns a valid Bearer token.
 * Re-uses cached token if valid; otherwise fetches a fresh one.
 */
async function getFleetxToken(forceRefresh = false) {
  if (!DEFAULT_FLEETX_USERNAME || !DEFAULT_FLEETX_PASSWORD || !DEFAULT_FLEETX_BASIC_AUTH) {
    throw new Error('FleetX credentials are not configured.');
  }
  const now = Date.now();
  if (!forceRefresh && cachedToken && tokenExpiresAt && now < tokenExpiresAt - 60000) {
    return cachedToken;
  }
  if (tokenLoginPromise) return tokenLoginPromise;

  tokenLoginPromise = (async () => {
    const loginUrl = `${DEFAULT_FLEETX_BASE_URL}/api/v1/login`;
    const form = new FormData();
    form.append('username', DEFAULT_FLEETX_USERNAME);
    form.append('password', DEFAULT_FLEETX_PASSWORD);
    form.append('grant_type', 'password');

    const headers = {
      Authorization: DEFAULT_FLEETX_BASIC_AUTH.startsWith('Basic ')
        ? DEFAULT_FLEETX_BASIC_AUTH
        : `Basic ${DEFAULT_FLEETX_BASIC_AUTH}`,
      ...form.getHeaders(),
    };

    try {
      console.log('[FleetX API] Authenticating with FleetX login API...');
      const response = await axios.post(loginUrl, form, { headers, timeout: 15000 });
      const token = response.data?.access_token || response.data?.accessToken || response.data?.token;

      if (!token) {
        throw new Error('FleetX login succeeded but no access_token was returned.');
      }

      cachedToken = token;
      let expiresAt = parseFleetxTimestamp(response.data?.expires_at || response.data?.expiry);
      if (!expiresAt) {
        const expiresInSec = parseOptionalNumber(response.data?.expires_in);
        expiresAt = expiresInSec && expiresInSec > 0
          ? new Date(Date.now() + expiresInSec * 1000)
          : new Date(Date.now() + 2 * 60 * 60 * 1000);
      }
      tokenExpiresAt = expiresAt.getTime();
      console.log('[FleetX API] Authentication successful, access token acquired.');
      return cachedToken;
    } catch (err) {
      cachedToken = null;
      tokenExpiresAt = null;
      const msg = err.response?.data?.error_description || err.response?.data?.message || err.message;
      console.error(`[FleetX Auth Error]: ${msg} (Status: ${err.response?.status || 'N/A'})`);
      throw new Error(`FleetX Authentication Failed: ${msg}`);
    } finally {
      tokenLoginPromise = null;
    }
  })();

  return tokenLoginPromise;
}

/**
 * Normalizes a raw FleetX vehicle telemetry object.
 */
function normalizeFleetxVehicle(item) {
  if (!item) return null;

  const lat = parseOptionalNumber(item.latitude);
  const lon = parseOptionalNumber(item.longitude);
  const speed = parseOptionalNumber(item.speed);

  let isIgnitionOn = null;
  const rawIgnition = item.otherAttributes?.ignition
    ?? item.ignition
    ?? item.ignitionStatus;
  if (rawIgnition !== undefined && rawIgnition !== null && rawIgnition !== '') {
    if (typeof rawIgnition === 'string') {
      const normalized = rawIgnition.trim().toLowerCase();
      if (['true', '1', 'on', 'yes'].includes(normalized)) isIgnitionOn = true;
      if (['false', '0', 'off', 'no'].includes(normalized)) isIgnitionOn = false;
    } else {
      isIgnitionOn = Boolean(rawIgnition);
    }
  }

  const rawTs = item.lastUpdatedAt ?? item.lastStatusTime ?? item.gpsTimestamp ?? item.otherAttributes?.serverTime;
  const timestamp = parseFleetxTimestamp(rawTs);
  const rawStatus = item.status || item.currentStatus || '';
  const statusLower = String(rawStatus).toLowerCase();
  let status = null;
  const currentStatus = String(item.currentStatus || '').toUpperCase();
  if (currentStatus === 'IDLE') status = 'Idle';
  else if (/running|moving/.test(statusLower) || currentStatus === 'RUNNING') status = 'Moving';
  else if (/parked|stopped/.test(statusLower) || currentStatus === 'PARKED') status = 'Stopped';
  if (!status && item.currentStatus) status = String(item.currentStatus);

  const numberCandidates = [
    item.vehicleNumber,
    item.vehicleRegistrationNumber,
    item.vehicleName,
    item.name,
  ].filter(Boolean).map((number) => String(number).trim());

  return {
    vehicleId: item.vehicleId || item.vehicle_id || item.id || null,
    vehicleNumber: numberCandidates[0] || '',
    vehicleNumberCandidates: [...new Set(numberCandidates.map(normalizeFleetxVehicleNumber).filter(Boolean))],
    vehicleName: item.vehicleName ? String(item.vehicleName).trim() : '',
    driverName: item.driverName ? item.driverName.trim() : '',
    latitude: lat !== null && lat >= -90 && lat <= 90 ? lat : null,
    longitude: lon !== null && lon >= -180 && lon <= 180 ? lon : null,
    speed,
    ignition: isIgnitionOn,
    ignitionStatus: isIgnitionOn === null ? null : (isIgnitionOn ? 'ON' : 'OFF'),
    deviceNumber: item.deviceId || item.otherAttributes?.imei || '',
    vendorName: 'FleetX',
    provider: 'FLEETX',
    vehicleType: item.vehicleTypeValue || item.vehicleMake || 'Commercial',
    address: item.address || '',
    timestamp,
    readableTime: timestamp ? timestamp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : null,
    status,
    rawStatus,
  };
}

/**
 * Fetches real-time telemetry for all vehicles from FleetX.
 */
async function fetchFleetxLiveTelemetry() {
  let token = await getFleetxToken();
  const liveUrl = `${DEFAULT_FLEETX_BASE_URL}/api/v1/analytics/live`;

  try {
    const response = await axios.get(liveUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      timeout: 15000,
    });

    const list = response.data?.vehicles
      || response.data?.data?.vehicles
      || (Array.isArray(response.data?.data) ? response.data.data : null)
      || (Array.isArray(response.data) ? response.data : []);
    return list.map(normalizeFleetxVehicle).filter(Boolean);
  } catch (err) {
    // If 401 Unauthorized, force refresh token and retry once
    if (err.response?.status === 401) {
      console.warn('[FleetX API] 401 Unauthorized received. Re-authenticating...');
      token = await getFleetxToken(true);
      const retryResponse = await axios.get(liveUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        timeout: 15000,
      });
      const list = retryResponse.data?.vehicles
        || retryResponse.data?.data?.vehicles
        || (Array.isArray(retryResponse.data?.data) ? retryResponse.data.data : null)
        || (Array.isArray(retryResponse.data) ? retryResponse.data : []);
      return list.map(normalizeFleetxVehicle).filter(Boolean);
    }

    const msg = err.response?.data?.error_description || err.response?.data?.message || err.message;
    throw new Error(`FleetX Live API error: ${msg}`);
  }
}

/**
 * Fetches real-time telemetry for a single vehicle by vehicle registration number.
 */
async function fetchFleetxVehicleByNumber(vehicleNumber) {
  if (!vehicleNumber) return null;
  const cleanNumber = normalizeFleetxVehicleNumber(vehicleNumber);
  let token = await getFleetxToken();
  const url = `${DEFAULT_FLEETX_BASE_URL}/api/v1/analytics/live/byNumber/${encodeURIComponent(cleanNumber)}`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `bearer ${token}`,
        Accept: 'application/json',
      },
      timeout: 15000,
    });

    const data = response.data?.vehicle || response.data?.data || response.data;
    return normalizeFleetxVehicle(data);
  } catch (err) {
    if (err.response?.status === 401) {
      token = await getFleetxToken(true);
      const retryResponse = await axios.get(url, {
        headers: {
          Authorization: `bearer ${token}`,
          Accept: 'application/json',
        },
        timeout: 15000,
      });
      const data = retryResponse.data?.vehicle || retryResponse.data?.data || retryResponse.data;
      return normalizeFleetxVehicle(data);
    }
    return null;
  }
}

async function fetchFleetxHistory({ vehicleId, from, to }) {
  if (!vehicleId) throw new Error('FleetX vehicleId is required.');
  if (!Number.isFinite(Number(from)) || !Number.isFinite(Number(to))) {
    throw new Error('Valid from and to millisecond timestamps are required.');
  }

  let token = await getFleetxToken();
  const url = `${DEFAULT_FLEETX_BASE_URL}/api/v2/trips/merged`;

  const params = {
    from: Number(from),
    to: Number(to),
    vehicleId,
    skipOBD: 'true',
    fields: 'COURSE,TYPE,LATITUDE,LONGITUDE,CREATE_DATE,DEVICE_ID,TIMESTAMP,STATUS,SPEED,VEHICLE_ID,VEHICLE_NAME,VEHICLE_NUMBER,DRIVER_NAME,DURATION_ENGINE_ON,TOTAL_ODOMETER,CURRENT_ODOMETER',
  };

  const fetchHistory = async (bearerToken) => axios.get(url, {
    params,
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: 'application/json',
    },
    timeout: 30000,
  });

  try {
    const response = await fetchHistory(token);
    return response.data;
  } catch (err) {
    if (err.response?.status === 401) {
      token = await getFleetxToken(true);
      const retryResponse = await fetchHistory(token);
      return retryResponse.data;
    }
    throw new Error(`FleetX History API error: ${err.response?.data?.message || err.message}`);
  }
}

module.exports = {
  getFleetxToken,
  fetchFleetxLiveTelemetry,
  fetchFleetxVehicleByNumber,
  fetchFleetxHistory,
  normalizeFleetxVehicle,
  normalizeFleetxVehicleNumber,
  parseFleetxTimestamp,
};
