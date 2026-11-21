const axios = require('axios');
const GpsGeocodeCache = require('../models/GpsGeocodeCache');
const VehicleGeocodeCache = require('../models/VehicleGeocodeCache');
const { calculateHaversineDistance } = require('./geofenceService');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'SikkaFleet/1.0 (+https://fleet.sikkaind.com)';
const MIN_REQUEST_INTERVAL_MS = 1000;
const VEHICLE_CACHE_MOVE_THRESHOLD_METERS = 200;

let lastRequestAt = 0;
let requestQueue = Promise.resolve();
const inFlightLookups = new Map();
const inFlightVehicleLookups = new Map();

function roundCoordinate(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function getCoordinateKey(latitude, longitude) {
  return `${roundCoordinate(latitude).toFixed(4)},${roundCoordinate(longitude).toFixed(4)}`;
}

function isVehicleGeocodeCacheCurrent(cached, latitude, longitude) {
  return Boolean(
    cached &&
    Number.isFinite(cached.latitude) &&
    Number.isFinite(cached.longitude) &&
    calculateHaversineDistance(latitude, longitude, cached.latitude, cached.longitude) <=
      VEHICLE_CACHE_MOVE_THRESHOLD_METERS
  );
}

function formatNominatimAddress(address) {
  if (!address || typeof address !== 'object') return '';
  const road = address.road || address.highway || address.pedestrian;
  const locality = address.village || address.town || address.city ||
    address.municipality || address.hamlet || address.suburb;
  const district = address.state_district || address.county || address.district;
  const state = address.state;
  return [...new Set([road, locality, district, state]
    .map((part) => typeof part === 'string' ? part.trim() : '')
    .filter(Boolean))].join(', ');
}

function enqueueNominatimRequest(latitude, longitude) {
  const request = async () => {
    const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRequestAt = Date.now();
    const response = await axios.get(NOMINATIM_URL, {
      params: {
        format: 'jsonv2',
        addressdetails: 1,
        lat: latitude,
        lon: longitude,
      },
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      timeout: 8000,
    });
    return formatNominatimAddress(response.data?.address);
  };
  const result = requestQueue.then(request, request);
  requestQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function reverseGeocode(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
      (latitude === 0 && longitude === 0)) {
    return null;
  }
  const roundedLatitude = roundCoordinate(latitude);
  const roundedLongitude = roundCoordinate(longitude);
  const coordinateKey = getCoordinateKey(latitude, longitude);
  const cached = await GpsGeocodeCache.findOne({ coordinateKey }).select('address').lean();
  if (cached) return cached.address || null;

  if (inFlightLookups.has(coordinateKey)) return inFlightLookups.get(coordinateKey);
  const lookup = (async () => {
    const address = await enqueueNominatimRequest(roundedLatitude, roundedLongitude);
    try {
      await GpsGeocodeCache.create({
        coordinateKey,
        latitude: roundedLatitude,
        longitude: roundedLongitude,
        address,
        source: 'Nominatim',
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const duplicate = await GpsGeocodeCache.findOne({ coordinateKey }).select('address').lean();
      return duplicate?.address || null;
    }
    return address || null;
  })();
  inFlightLookups.set(coordinateKey, lookup);
  try {
    return await lookup;
  } finally {
    inFlightLookups.delete(coordinateKey);
  }
}

async function reverseGeocodeForVehicle(vehicleKey, latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
      (latitude === 0 && longitude === 0)) {
    return null;
  }
  if (!vehicleKey) return reverseGeocode(latitude, longitude);

  vehicleKey = vehicleKey.toString();
  const cached = await VehicleGeocodeCache.findOne({ vehicleKey })
    .select('latitude longitude address')
    .lean();
  if (isVehicleGeocodeCacheCurrent(cached, latitude, longitude)) {
    return cached.address || null;
  }

  const lookupKey = `${vehicleKey}:${getCoordinateKey(latitude, longitude)}`;
  if (inFlightVehicleLookups.has(lookupKey)) {
    return inFlightVehicleLookups.get(lookupKey);
  }

  const lookup = (async () => {
    const address = await reverseGeocode(latitude, longitude);
    await VehicleGeocodeCache.findOneAndUpdate(
      { vehicleKey },
      {
        $set: {
          latitude,
          longitude,
          address: address || '',
          geocodedAt: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    return address || null;
  })();
  inFlightVehicleLookups.set(lookupKey, lookup);
  try {
    return await lookup;
  } finally {
    inFlightVehicleLookups.delete(lookupKey);
  }
}

module.exports = {
  formatNominatimAddress,
  getCoordinateKey,
  isVehicleGeocodeCacheCurrent,
  reverseGeocode,
  reverseGeocodeForVehicle,
};
