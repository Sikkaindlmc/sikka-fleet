const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const mongoose = require('mongoose');
const GpsGeocodeCache = require('../models/GpsGeocodeCache');
const VehicleGeocodeCache = require('../models/VehicleGeocodeCache');
const {
  formatNominatimAddress,
  getCoordinateKey,
  isVehicleGeocodeCacheCurrent,
  reverseGeocodeForVehicle,
} = require('../services/reverseGeocodeService');
const { getReadableLocation, isReadableProviderAddress } = require('../services/locationHelper');

test('Nominatim results are reduced to locality, district, and state', () => {
  assert.equal(
    formatNominatimAddress({
      village: 'Example Village',
      state_district: 'Example District',
      state: 'Uttar Pradesh',
      country: 'India',
    }),
    'Example Village, Example District, Uttar Pradesh'
  );
  assert.equal(formatNominatimAddress({}), '');
});

test('reverse-geocode cache keys round coordinates to four decimal places', () => {
  assert.equal(getCoordinateKey(28.123456, 77.987654), '28.1235,77.9877');
});

test('vehicle geocode cache reuses the address until movement exceeds 200 meters', async () => {
  const originalFindOne = VehicleGeocodeCache.findOne;
  const originalFindOneAndUpdate = VehicleGeocodeCache.findOneAndUpdate;
  const originalGpsFindOne = GpsGeocodeCache.findOne;
  const originalGpsCreate = GpsGeocodeCache.create;
  const originalAxiosGet = axios.get;
  let requests = 0;
  VehicleGeocodeCache.findOne = () => ({
    select: () => ({
      lean: async () => ({ latitude: 28.5, longitude: 77.2, address: 'NH 9, Hapur' }),
    }),
  });
  VehicleGeocodeCache.findOneAndUpdate = async () => ({});
  GpsGeocodeCache.findOne = () => ({
    select: () => ({ lean: async () => null }),
  });
  GpsGeocodeCache.create = async () => ({});
  axios.get = async () => {
    requests++;
    return {
      data: {
        address: {
          road: 'NH 9',
          city: 'Hapur',
          state: 'Uttar Pradesh',
        },
      },
    };
  };

  try {
    const vehicleId = new mongoose.Types.ObjectId();
    assert.equal(
      await reverseGeocodeForVehicle(vehicleId, 28.5005, 77.2),
      'NH 9, Hapur'
    );
    assert.equal(
      await reverseGeocodeForVehicle(vehicleId, 28.503, 77.2),
      'NH 9, Hapur, Uttar Pradesh'
    );
    assert.equal(requests, 1);
  } finally {
    VehicleGeocodeCache.findOne = originalFindOne;
    VehicleGeocodeCache.findOneAndUpdate = originalFindOneAndUpdate;
    GpsGeocodeCache.findOne = originalGpsFindOne;
    GpsGeocodeCache.create = originalGpsCreate;
    axios.get = originalAxiosGet;
  }
});

test('concurrent lookups at different vehicle positions do not share an address', async () => {
  const originalFindOne = VehicleGeocodeCache.findOne;
  const originalFindOneAndUpdate = VehicleGeocodeCache.findOneAndUpdate;
  const originalGpsFindOne = GpsGeocodeCache.findOne;
  const originalGpsCreate = GpsGeocodeCache.create;
  const originalAxiosGet = axios.get;
  VehicleGeocodeCache.findOne = () => ({
    select: () => ({
      lean: async () => ({ latitude: 28.49, longitude: 77.2, address: 'Old position' }),
    }),
  });
  VehicleGeocodeCache.findOneAndUpdate = async () => ({});
  GpsGeocodeCache.findOne = () => ({
    select: () => ({ lean: async () => null }),
  });
  GpsGeocodeCache.create = async () => ({});
  axios.get = async (_url, { params }) => ({
    data: { address: { road: `Road ${params.lat}` } },
  });

  try {
    const addresses = await Promise.all([
      reverseGeocodeForVehicle('vehicle-test', 28.5, 77.2),
      reverseGeocodeForVehicle('vehicle-test', 28.503, 77.2),
    ]);
    assert.deepEqual(addresses, ['Road 28.5', 'Road 28.503']);
  } finally {
    VehicleGeocodeCache.findOne = originalFindOne;
    VehicleGeocodeCache.findOneAndUpdate = originalFindOneAndUpdate;
    GpsGeocodeCache.findOne = originalGpsFindOne;
    GpsGeocodeCache.create = originalGpsCreate;
    axios.get = originalAxiosGet;
  }
});

test('vehicle geocode cache refresh threshold is about 200 meters', () => {
  const cached = { latitude: 28.5, longitude: 77.2 };
  assert.equal(isVehicleGeocodeCacheCurrent(cached, 28.5005, 77.2), true);
  assert.equal(isVehicleGeocodeCacheCurrent(cached, 28.503, 77.2), false);
});

test('reverse-geocoded labels include a road when available', () => {
  assert.equal(
    formatNominatimAddress({
      road: 'NH 9',
      city: 'Hapur',
      state_district: 'Hapur',
      state: 'Uttar Pradesh',
    }),
    'NH 9, Hapur, Uttar Pradesh'
  );
});

test('unreadable coordinate strings are rejected and fallback locations never expose coordinates', () => {
  assert.equal(isReadableProviderAddress('En Route (28.2024, 78.2598)'), false);
  assert.equal(isReadableProviderAddress('Hapur, Uttar Pradesh'), true);
  assert.equal(getReadableLocation(28.2024, 78.2598), 'Location unavailable');
  assert.match(
    getReadableLocation(28.5, 77.2, [{
      plantName: 'Salt Plant',
      latitude: 28.4,
      longitude: 77.2,
      radiusMeters: 100,
    }]),
    /^About \d+\.\d km from Salt Plant$/
  );
});
