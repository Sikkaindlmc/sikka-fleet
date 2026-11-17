const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const {
  fetchWheelseyeTelemetryWithRetries,
  fetchWheelsEyeTelemetry,
  fetchFleetxTelemetryWithRetries,
  fetchFleetxVehicleTelemetry,
  getFleetxVehicleUrl,
  findOpenProviderZoneSession,
  parseTelematicsTimestamp,
  selectLatestTelemetryByVehicle,
  acquireDistributedLock,
} = require('../services/gpsSyncService');
const { getCurrentIstSlotKey } = require('../services/gpsScheduler');
const GpsSyncLock = require('../models/GpsSyncLock');
const ZoneSession = require('../models/ZoneSession');

test('FleetX login uses the configured multipart password grant and bearer token', async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const originalEnv = {
    FLEETX_LOGIN_URL: process.env.FLEETX_LOGIN_URL,
    FLEETX_USERNAME: process.env.FLEETX_USERNAME,
    FLEETX_PASSWORD: process.env.FLEETX_PASSWORD,
    FLEETX_BASIC_AUTH: process.env.FLEETX_BASIC_AUTH,
  };
  let loginRequest;
  let apiAuthorization;
  process.env.FLEETX_LOGIN_URL = 'https://api.fleetx.io/api/v1/login';
  process.env.FLEETX_USERNAME = 'fleetx-test-user';
  process.env.FLEETX_PASSWORD = 'fleetx-test-password';
  process.env.FLEETX_BASIC_AUTH = 'Basic test-authorization';
  axios.post = async (url, body, config) => {
    loginRequest = { url, body, config };
    return { data: { access_token: 'fresh-test-token' } };
  };
  axios.get = async (_url, config) => {
    apiAuthorization = config.headers.Authorization;
    return { status: 200, data: { data: [] } };
  };
  try {
    const result = await fetchFleetxTelemetryWithRetries(
      'https://api.fleetx.io/api/v1/analytics/live'
    );
    assert.ok(loginRequest.body instanceof FormData);
    assert.equal(loginRequest.body.get('username'), 'fleetx-test-user');
    assert.equal(loginRequest.body.get('password'), 'fleetx-test-password');
    assert.equal(loginRequest.body.get('grant_type'), 'password');
    assert.equal(loginRequest.config.headers.Authorization, 'Basic test-authorization');
    assert.equal(apiAuthorization, 'Bearer fresh-test-token');
    assert.deepEqual(result.list, []);
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('FleetX uses a fresh login token before fetching and refreshes it after unauthorized response', async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const originalSetTimeout = global.setTimeout;
  const originalEnv = {
    FLEETX_LOGIN_URL: process.env.FLEETX_LOGIN_URL,
    FLEETX_USERNAME: process.env.FLEETX_USERNAME,
    FLEETX_PASSWORD: process.env.FLEETX_PASSWORD,
    FLEETX_BASIC_AUTH: process.env.FLEETX_BASIC_AUTH,
  };
  const authHeaders = [];
  let loginCount = 0;
  let requestCount = 0;
  process.env.FLEETX_LOGIN_URL = 'https://api.fleetx.io/api/v1/login';
  process.env.FLEETX_USERNAME = 'fleetx-test-user';
  process.env.FLEETX_PASSWORD = 'fleetx-test-password';
  process.env.FLEETX_BASIC_AUTH = '';
  global.setTimeout = (callback) => {
    callback();
    return 0;
  };
  axios.post = async () => {
    loginCount += 1;
    return { data: { access_token: `fresh-test-token-${loginCount}` } };
  };
  axios.get = async (_url, config) => {
    requestCount += 1;
    authHeaders.push(config.headers.Authorization);
    if (requestCount === 1) {
      const error = new Error('Unauthorized');
      error.response = { status: 401 };
      throw error;
    }
    return { status: 200, data: [] };
  };
  try {
    await fetchFleetxTelemetryWithRetries(
      'https://api.fleetx.io/api/v1/analytics/live',
      3,
      'expired-test-token'
    );
    assert.equal(requestCount, 2);
    assert.equal(loginCount, 2);
    assert.deepEqual(authHeaders, [
      'Bearer fresh-test-token-1',
      'Bearer fresh-test-token-2',
    ]);
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
    global.setTimeout = originalSetTimeout;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('FleetX coalesces simultaneous login requests', async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const originalEnv = {
    FLEETX_LOGIN_URL: process.env.FLEETX_LOGIN_URL,
    FLEETX_USERNAME: process.env.FLEETX_USERNAME,
    FLEETX_PASSWORD: process.env.FLEETX_PASSWORD,
    FLEETX_BASIC_AUTH: process.env.FLEETX_BASIC_AUTH,
  };
  let loginCount = 0;
  process.env.FLEETX_LOGIN_URL = 'https://api.fleetx.io/api/v1/login';
  process.env.FLEETX_USERNAME = 'fleetx-test-user';
  process.env.FLEETX_PASSWORD = 'fleetx-test-password';
  process.env.FLEETX_BASIC_AUTH = '';
  axios.post = async () => {
    loginCount += 1;
    await Promise.resolve();
    return { data: { access_token: 'shared-test-token' } };
  };
  axios.get = async () => ({ status: 200, data: [] });
  try {
    await Promise.all([
      fetchFleetxTelemetryWithRetries('https://api.fleetx.io/api/v1/analytics/live'),
      fetchFleetxTelemetryWithRetries('https://api.fleetx.io/api/v1/analytics/live'),
    ]);
    assert.equal(loginCount, 1);
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('FleetX retries an unauthorized request only once after refreshing the token', async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const originalEnv = {
    FLEETX_LOGIN_URL: process.env.FLEETX_LOGIN_URL,
    FLEETX_USERNAME: process.env.FLEETX_USERNAME,
    FLEETX_PASSWORD: process.env.FLEETX_PASSWORD,
    FLEETX_BASIC_AUTH: process.env.FLEETX_BASIC_AUTH,
  };
  let loginCount = 0;
  let requestCount = 0;
  process.env.FLEETX_LOGIN_URL = 'https://api.fleetx.io/api/v1/login';
  process.env.FLEETX_USERNAME = 'fleetx-test-user';
  process.env.FLEETX_PASSWORD = 'fleetx-test-password';
  process.env.FLEETX_BASIC_AUTH = '';
  axios.post = async () => {
    loginCount += 1;
    return { data: { access_token: `refreshed-test-token-${loginCount}` } };
  };
  axios.get = async () => {
    requestCount += 1;
    const error = new Error('Unauthorized');
    error.response = { status: 401 };
    throw error;
  };
  try {
    await assert.rejects(fetchFleetxTelemetryWithRetries(
      'https://api.fleetx.io/api/v1/analytics/live',
      3,
      'expired-test-token'
    ));
    assert.equal(requestCount, 2);
    assert.equal(loginCount, 2);
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('FleetX falls back to the configured bearer token when login credentials are unavailable', async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const originalEnv = {
    FLEETX_LOGIN_URL: process.env.FLEETX_LOGIN_URL,
    FLEETX_USERNAME: process.env.FLEETX_USERNAME,
    FLEETX_PASSWORD: process.env.FLEETX_PASSWORD,
  };
  let apiAuthorization;
  delete process.env.FLEETX_LOGIN_URL;
  delete process.env.FLEETX_USERNAME;
  delete process.env.FLEETX_PASSWORD;
  axios.post = async () => {
    throw new Error('Login should not be called without configured credentials.');
  };
  axios.get = async (_url, config) => {
    apiAuthorization = config.headers.Authorization;
    return { status: 200, data: [] };
  };
  try {
    await fetchFleetxTelemetryWithRetries(
      'https://api.fleetx.io/api/v1/analytics/live',
      3,
      'configured-static-token'
    );
    assert.equal(apiAuthorization, 'Bearer configured-static-token');
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('FleetX vehicle endpoint appends an encoded vehicle number', () => {
  const originalVehicleUrl = process.env.FLEETX_VEHICLE_URL;
  process.env.FLEETX_VEHICLE_URL = 'https://api.fleetx.io/api/v1/analytics/live/byNumber';
  try {
    assert.equal(
      getFleetxVehicleUrl('TN09 CV 0182'),
      'https://api.fleetx.io/api/v1/analytics/live/byNumber/TN09%20CV%200182'
    );
  } finally {
    if (originalVehicleUrl === undefined) delete process.env.FLEETX_VEHICLE_URL;
    else process.env.FLEETX_VEHICLE_URL = originalVehicleUrl;
  }
});

test('FleetX single-vehicle lookup uses the byNumber endpoint and normalizes telemetry', async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const originalEnv = {
    FLEETX_LOGIN_URL: process.env.FLEETX_LOGIN_URL,
    FLEETX_USERNAME: process.env.FLEETX_USERNAME,
    FLEETX_PASSWORD: process.env.FLEETX_PASSWORD,
    FLEETX_BASIC_AUTH: process.env.FLEETX_BASIC_AUTH,
    FLEETX_VEHICLE_URL: process.env.FLEETX_VEHICLE_URL,
  };
  let requestedUrl;
  process.env.FLEETX_LOGIN_URL = 'https://api.fleetx.io/api/v1/login';
  process.env.FLEETX_USERNAME = 'fleetx-test-user';
  process.env.FLEETX_PASSWORD = 'fleetx-test-password';
  process.env.FLEETX_BASIC_AUTH = '';
  process.env.FLEETX_VEHICLE_URL = 'https://api.fleetx.io/api/v1/analytics/live/byNumber';
  axios.post = async () => ({ data: { data: { token: 'vehicle-test-token' } } });
  axios.get = async (url) => {
    requestedUrl = url;
    return {
      status: 200,
      data: {
        data: {
          vehicleNumber: 'TN09CV0182',
          latitude: '13.08',
          longitude: '80.27',
          speed: '35',
          lastUpdated: '2026-11-17T10:00:00Z',
        },
      },
    };
  };
  try {
    const result = await fetchFleetxVehicleTelemetry('TN09CV0182');
    assert.match(requestedUrl, /\/byNumber\/TN09CV0182$/);
    assert.equal(result.length, 1);
    assert.equal(result[0].vehicleNumber, 'TN09CV0182');
    assert.equal(result[0].latitude, 13.08);
    assert.equal(result[0].longitude, 80.27);
    assert.equal(result[0].speed, 35);
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('GPS sync safely treats a missing ZoneSession as no open session', async () => {
  const originalFindOne = ZoneSession.findOne;
  let query;
  ZoneSession.findOne = (filter) => {
    query = filter;
    return { sort: async () => null };
  };
  try {
    const session = await findOpenProviderZoneSession('up 14-aa 1001', 'FleetX');
    assert.equal(session, null);
    assert.equal(query.vehicleNumberNormalized, 'UP14AA1001');
    assert.equal(query.provider, 'FleetX');
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
