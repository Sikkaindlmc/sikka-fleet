const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const {
  fetchWheelseyeTelemetryWithRetries,
  fetchWheelsEyeTelemetry,
  findOpenProviderZoneSession,
  normalizeWheelseyeItem,
  parseTelematicsTimestamp,
  selectLatestTelemetryByVehicle,
  acquireDistributedLock,
} = require('../services/gpsSyncService');
const { getCurrentIstSlotKey } = require('../services/gpsScheduler');
const GpsSyncLock = require('../models/GpsSyncLock');
const ZoneSession = require('../models/ZoneSession');

test('GPS sync safely treats a missing ZoneSession as no open session', async () => {
  const originalFindOne = ZoneSession.findOne;
  let query;
  ZoneSession.findOne = (filter) => {
    query = filter;
    return { sort: async () => null };
  };
  try {
    const session = await findOpenProviderZoneSession('up 14-aa 1001');
    assert.equal(session, null);
    assert.equal(query.vehicleNumberNormalized, 'UP14AA1001');
    assert.equal(query.provider, 'WheelsEye GPS');
  } finally {
    ZoneSession.findOne = originalFindOne;
  }
});

test('WheelsEye authentication failure is not retried and exposes only its HTTP status', async () => {
  const originalGet = axios.get;
  const originalWarn = console.warn;
  let attempts = 0;
  const logs = [];
  axios.get = async () => {
    attempts += 1;
    const error = new Error('Unauthorized token-must-not-leak');
    error.response = { status: 401 };
    throw error;
  };
  console.warn = (...args) => logs.push(args.join(' '));
  try {
    await assert.rejects(fetchWheelseyeTelemetryWithRetries(
      'https://api.example.com/gps?accessToken=secret-token',
      3
    ));
    assert.equal(attempts, 1);
    assert.doesNotMatch(logs.join(' '), /secret-token|token-must-not-leak/);
  } finally {
    axios.get = originalGet;
    console.warn = originalWarn;
  }
});

test('WheelsEye telemetry is the only requested source and normalizes its returned values', async () => {
  const originalGet = axios.get;
  const requestedUrls = [];
  axios.get = async (url) => {
    requestedUrls.push(url);
    return {
      status: 200,
      data: {
        list: [{
          vehicleNumber: 'up 14-aa 1001',
          latitude: '28.5',
          longitude: '77.2',
          speed: '0',
          ignition: 'false',
          gpsTimestamp: '2026-11-16T10:00:00Z',
        }],
      },
    };
  };
  try {
    const result = await fetchWheelsEyeTelemetry([
      { provider: 'WheelsEye GPS', status: 'Active', apiUrl: 'https://wheels.example/gps' },
      { provider: 'legacy-source', status: 'Active', apiUrl: 'https://legacy.example/gps' },
    ]);
    assert.equal(result.vehicles.length, 1);
    assert.equal(result.vehicles[0].vehicleNumber, 'UP14AA1001');
    assert.equal(result.vehicles[0].speed, 0);
    assert.equal(result.vehicles[0].ignition, false);
    assert.deepEqual(requestedUrls.map((url) => new URL(url).hostname), ['wheels.example']);
  } finally {
    axios.get = originalGet;
  }
});

test('WheelsEye currentLoc response aliases and default endpoint map into telemetry', async () => {
  const originalGet = axios.get;
  const originalEnv = {
    WHEELSEYE_API_URL: process.env.WHEELSEYE_API_URL,
    WHEELSEYE_API_KEY: process.env.WHEELSEYE_API_KEY,
    WHEELSEYE_ACCESS_TOKEN: process.env.WHEELSEYE_ACCESS_TOKEN,
  };
  let requestedUrl;
  delete process.env.WHEELSEYE_API_URL;
  delete process.env.WHEELSEYE_API_KEY;
  delete process.env.WHEELSEYE_ACCESS_TOKEN;
  axios.get = async (url) => {
    requestedUrl = new URL(url);
    return {
      status: 200,
      data: [{
        vehicleNo: 'tn 09-cv 0182',
        lat: '13.08',
        lon: '80.27',
        speedKmph: '31',
        gpsTime: '2026-11-17T10:00:00Z',
      }],
    };
  };
  try {
    const result = await fetchWheelsEyeTelemetry([]);
    assert.equal(requestedUrl.hostname, 'api.wheelseye.com');
    assert.equal(requestedUrl.pathname, '/currentLoc');
    assert.equal(result.vehicles.length, 1);
    assert.equal(result.vehicles[0].vehicleNumber, 'TN09CV0182');
    assert.equal(result.vehicles[0].latitude, 13.08);
    assert.equal(result.vehicles[0].longitude, 80.27);
    assert.equal(result.vehicles[0].speed, 31);
    assert.equal(
      normalizeWheelseyeItem({ vehicleNo: 'tn 09-cv 0182', lat: '13.08', lon: '80.27' }).vehicleNumber,
      'TN09CV0182'
    );
  } finally {
    axios.get = originalGet;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('default WheelsEye endpoint remains active when a stale setting has no URL', async () => {
  const originalGet = axios.get;
  const originalEnv = {
    WHEELSEYE_API_URL: process.env.WHEELSEYE_API_URL,
    WHEELSEYE_API_KEY: process.env.WHEELSEYE_API_KEY,
    WHEELSEYE_ACCESS_TOKEN: process.env.WHEELSEYE_ACCESS_TOKEN,
  };
  let requestedUrl;
  delete process.env.WHEELSEYE_API_URL;
  delete process.env.WHEELSEYE_API_KEY;
  delete process.env.WHEELSEYE_ACCESS_TOKEN;
  axios.get = async (url) => {
    requestedUrl = new URL(url);
    return { status: 200, data: [] };
  };
  try {
    const result = await fetchWheelsEyeTelemetry([
      { provider: 'WheelsEye GPS', status: 'Inactive', apiUrl: '' },
    ]);
    assert.equal(requestedUrl.hostname, 'api.wheelseye.com');
    assert.equal(requestedUrl.pathname, '/currentLoc');
    assert.equal(result.vehicles.length, 0);
  } finally {
    axios.get = originalGet;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a configured WheelsEye environment URL overrides a stale inactive database setting', async () => {
  const originalGet = axios.get;
  const originalEnv = {
    WHEELSEYE_API_URL: process.env.WHEELSEYE_API_URL,
    WHEELSEYE_API_KEY: process.env.WHEELSEYE_API_KEY,
    WHEELSEYE_ACCESS_TOKEN: process.env.WHEELSEYE_ACCESS_TOKEN,
  };
  let requestedUrl;
  process.env.WHEELSEYE_API_URL = 'https://wheels.example/currentLoc';
  process.env.WHEELSEYE_API_KEY = 'test-wheels-token';
  delete process.env.WHEELSEYE_ACCESS_TOKEN;
  axios.get = async (url) => {
    requestedUrl = new URL(url);
    return {
      status: 200,
      data: {
        list: [{
          vehicleNumber: 'UP14AA1001',
          latitude: '28.5',
          longitude: '77.2',
          gpsTimestamp: '2026-11-17T10:00:00Z',
        }],
      },
    };
  };
  try {
    const result = await fetchWheelsEyeTelemetry([
      { provider: 'WheelsEye GPS', status: 'Inactive', apiUrl: 'https://old-wheels.example/gps' },
    ]);
    assert.equal(requestedUrl.hostname, 'wheels.example');
    assert.equal(requestedUrl.searchParams.get('accessToken'), 'test-wheels-token');
    assert.equal(result.vehicles.length, 1);
  } finally {
    axios.get = originalGet;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('current processing selects only the latest GPS fix per normalized vehicle number', () => {
  const latest = selectLatestTelemetryByVehicle([
    { vehicleNumber: 'up 14-aa 1001', timestamp: new Date('2026-11-17T06:30:00Z'), speed: 10 },
    { vehicleNumber: 'UP14AA1001', timestamp: new Date('2026-11-17T07:00:00Z'), speed: 20 },
    { vehicleNumber: 'UP14BB2002', timestamp: new Date('2026-11-17T06:45:00Z'), speed: 0 },
  ]);
  assert.equal(latest.length, 2);
  assert.equal(latest.find((item) => item.vehicleNumber === 'UP14AA1001').speed, 20);
});

test('WheelsEye failures produce a precise, redacted request error', async () => {
  const originalGet = axios.get;
  const originalWarn = console.warn;
  const logs = [];
  axios.get = async () => {
    const error = new Error('Unauthorized secret-token');
    error.response = { status: 401 };
    throw error;
  };
  console.warn = (...args) => logs.push(args.join(' '));
  try {
    await assert.rejects(
      fetchWheelsEyeTelemetry([
        { provider: 'WheelsEye GPS', status: 'Active', apiUrl: 'https://wheels.example/gps' },
      ]),
      (error) => {
        assert.match(error.message, /WheelsEye request failed with HTTP 401/);
        assert.doesNotMatch(error.message, /secret-token/);
        assert.equal(error.wheelsEyeStatus.status, 'HTTP 401');
        return true;
      }
    );
    assert.doesNotMatch(logs.join(' '), /secret-token/);
  } finally {
    axios.get = originalGet;
    console.warn = originalWarn;
  }
});

test('transient WheelsEye failures retry at most three times with exponential backoff', async () => {
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

test('rejects timezone-free vendor timestamps and parses explicit offsets', () => {
  assert.equal(parseTelematicsTimestamp({ gpsTimestamp: '2026-01-01 12:00:00' }), null);
  assert.equal(
    parseTelematicsTimestamp({ gpsTimestamp: '2026-01-01T12:00:00+05:30' }).toISOString(),
    '2026-01-01T06:30:00.000Z'
  );
  assert.equal(getCurrentIstSlotKey(new Date('2026-01-01T18:30:00Z')), '2026-01-02_00:00');
  assert.equal(getCurrentIstSlotKey(new Date('2026-01-01T19:00:00Z')), '2026-01-02_00:30');
});

test('overlapping sync workers cannot both acquire the database lock', async () => {
  const originalFindOneAndUpdate = GpsSyncLock.findOneAndUpdate;
  let locked = false;
  GpsSyncLock.findOneAndUpdate = async () => {
    if (locked) {
      const error = new Error('Duplicate lock');
      error.code = 11000;
      throw error;
    }
    locked = true;
    return { _id: 'gps_sync_lock' };
  };
  try {
    const acquisitions = await Promise.all([
      acquireDistributedLock('AUTO'),
      acquireDistributedLock('MANUAL'),
    ]);
    assert.deepEqual(acquisitions.sort(), [false, true]);
  } finally {
    GpsSyncLock.findOneAndUpdate = originalFindOneAndUpdate;
  }
});
