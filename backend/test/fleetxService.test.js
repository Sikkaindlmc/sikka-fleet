const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
process.env.FLEETX_API_BASE_URL = process.env.FLEETX_API_BASE_URL || 'https://api.fleetx.io';
process.env.FLEETX_BASIC_AUTH = process.env.FLEETX_BASIC_AUTH || 'Basic test';
process.env.FLEETX_USERNAME = process.env.FLEETX_USERNAME || 'test-user';
process.env.FLEETX_PASSWORD = process.env.FLEETX_PASSWORD || 'test-password';
const {
  normalizeFleetxVehicle,
  normalizeFleetxVehicleNumber,
  fetchFleetxLiveTelemetry,
  parseFleetxTimestamp,
} = require('../services/fleetxService');

test('FleetX normalization uses actual live response fields and matching candidates', () => {
  const result = normalizeFleetxVehicle({
    vehicleId: 3224417,
    vehicleNumber: 'UP14TT8797_CAM',
    vehicleName: '8797',
    latitude: 28.640838,
    longitude: 77.438211,
    speed: 0,
    status: 'Ignition Off',
    currentStatus: 'PARKED',
    lastUpdatedAt: 1795242321000,
    address: 'Ghaziabad',
    otherAttributes: {
      ignition: 'true',
      imei: '867470080678391',
    },
  });

  assert.equal(normalizeFleetxVehicleNumber('UP14TT8797_CAM'), 'UP14TT8797');
  assert.deepEqual(result.vehicleNumberCandidates, ['UP14TT8797', '8797']);
  assert.equal(result.latitude, 28.640838);
  assert.equal(result.longitude, 77.438211);
  assert.equal(result.speed, 0);
  assert.equal(result.ignition, true);
  assert.equal(result.status, 'Stopped');
  assert.equal(result.timestamp.toISOString(), '2026-11-21T06:25:21.000Z');
});

test('FleetX missing or invalid GPS fields remain missing instead of becoming fake values', () => {
  const missingTimestamp = normalizeFleetxVehicle({
    vehicleNumber: 'UP14TT8109',
    latitude: 'not-a-number',
    longitude: null,
    speed: null,
  });
  assert.equal(missingTimestamp.latitude, null);
  assert.equal(missingTimestamp.longitude, null);
  assert.equal(missingTimestamp.speed, null);
  assert.equal(missingTimestamp.ignition, null);
  assert.equal(missingTimestamp.timestamp, null);
  assert.equal(parseFleetxTimestamp(''), null);
});

test('FleetX live API retries one 401 and sends no browser-only headers', async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  let loginAttempts = 0;
  let liveAttempts = 0;
  const liveHeaders = [];

  axios.post = async () => {
    loginAttempts++;
    return { status: 200, data: { access_token: `test-token-${loginAttempts}`, expires_in: 7200 } };
  };
  axios.get = async (_url, config) => {
    liveAttempts++;
    liveHeaders.push(config.headers);
    if (liveAttempts === 1) {
      const error = new Error('Unauthorized');
      error.response = { status: 401 };
      throw error;
    }
    return {
      status: 200,
      data: {
        vehicles: [{
          vehicleNumber: 'UP14GT3942',
          latitude: 28.5470666,
          longitude: 77.4626966,
          speed: 30,
          currentStatus: 'RUNNING',
          lastUpdatedAt: 1795242361000,
        }],
      },
    };
  };

  try {
    const result = await fetchFleetxLiveTelemetry();
    assert.equal(loginAttempts, 2);
    assert.equal(liveAttempts, 2);
    assert.equal(result.length, 1);
    assert.equal(result[0].vehicleNumber, 'UP14GT3942');
    for (const headers of liveHeaders) {
      assert.equal(headers.Accept, 'application/json');
      assert.equal(headers.Authorization.startsWith('Bearer test-token-'), true);
      assert.equal(Object.hasOwn(headers, 'clientid'), false);
      assert.equal(Object.hasOwn(headers, 'origin'), false);
      assert.equal(Object.hasOwn(headers, 'referer'), false);
    }
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }
});
