const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const {
  fetchWheelseyeTelemetryWithRetries,
  fetchFleetxTelemetryWithRetries,
  parseTelematicsTimestamp,
} = require('../services/gpsSyncService');
const { getCurrentIstSlotKey } = require('../services/gpsScheduler');

test('provider authentication failure is not retried', async () => {
  const originalGet = axios.get;
  let attempts = 0;
  axios.get = async () => {
    attempts += 1;
    const error = new Error('Unauthorized');
    error.response = { status: 401 };
    throw error;
  };
  try {
    await assert.rejects(fetchWheelseyeTelemetryWithRetries('https://api.example.com/gps', 3));
    assert.equal(attempts, 1);
  } finally {
    axios.get = originalGet;
  }
});

test('Fleetx authentication failure is not retried', async () => {
  const originalGet = axios.get;
  let attempts = 0;
  axios.get = async () => {
    attempts += 1;
    const error = new Error('Forbidden');
    error.response = { status: 403 };
    throw error;
  };
  try {
    await assert.rejects(fetchFleetxTelemetryWithRetries('https://api.example.com/gps', 'token', 3));
    assert.equal(attempts, 1);
  } finally {
    axios.get = originalGet;
  }
});

test('transient provider failures retry at most three times with exponential backoff', async () => {
  const originalGet = axios.get;
  const originalSetTimeout = global.setTimeout;
  const delays = [];
  let attempts = 0;
  axios.get = async () => {
    attempts += 1;
    const error = new Error('Service unavailable');
    error.response = { status: 503 };
    throw error;
  };
  global.setTimeout = (callback, delay) => {
    delays.push(delay);
    callback();
    return 0;
  };
  try {
    await assert.rejects(fetchWheelseyeTelemetryWithRetries('https://api.example.com/gps', 3));
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1000, 2000]);
  } finally {
    axios.get = originalGet;
    global.setTimeout = originalSetTimeout;
  }
});

test('parses timezone-free vendor timestamps as UTC and computes fixed IST sync slots', () => {
  assert.equal(
    parseTelematicsTimestamp({ gpsTimestamp: '2026-01-01 12:00:00' }).toISOString(),
    '2026-01-01T12:00:00.000Z'
  );
  assert.equal(getCurrentIstSlotKey(new Date('2026-01-01T18:30:00Z')), '2026-01-02_00:00');
  assert.equal(getCurrentIstSlotKey(new Date('2026-01-01T19:00:00Z')), '2026-01-02_00:30');
});
