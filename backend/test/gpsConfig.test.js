const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  getMissingProviderEnvironment,
  getMissingRequiredEnvironment,
} = require('../config/gpsConfig');
const { getWheelseyeUrl } = require('../services/wheelseyeService');

const GPS_ENV_NAMES = [
  'MONGODB_URI',
  'MONGO_URI',
  'MONGODB_DIRECT_URI',
  'JWT_SECRET',
  'CRON_SECRET',
  'WHEELSEYE_ACCESS_TOKEN',
  'WHEELSEYE_API_KEY',
  'FLEETX_USERNAME',
  'FLEETX_PASSWORD',
  'FLEETX_BASIC_AUTH',
];

test('missing environment checks report setting names only', () => {
  const originalEnvironment = Object.fromEntries(
    GPS_ENV_NAMES.map((name) => [name, process.env[name]])
  );
  for (const name of GPS_ENV_NAMES) delete process.env[name];

  try {
    assert.deepEqual(getMissingProviderEnvironment('WHEELSEYE'), ['WHEELSEYE_ACCESS_TOKEN']);
    assert.deepEqual(getMissingProviderEnvironment('FLEETX'), [
      'FLEETX_USERNAME',
      'FLEETX_PASSWORD',
      'FLEETX_BASIC_AUTH',
    ]);
    assert.deepEqual(getMissingRequiredEnvironment(), [
      'MONGODB_URI',
      'JWT_SECRET',
      'CRON_SECRET',
      'WHEELSEYE_ACCESS_TOKEN',
      'FLEETX_USERNAME',
      'FLEETX_PASSWORD',
      'FLEETX_BASIC_AUTH',
    ]);
  } finally {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('WheelsEye URL reads the access token from the current environment each time', () => {
  const originalUrl = process.env.WHEELSEYE_API_URL;
  const originalAccessToken = process.env.WHEELSEYE_ACCESS_TOKEN;
  const originalApiKey = process.env.WHEELSEYE_API_KEY;
  const firstToken = crypto.randomBytes(24).toString('hex');
  const nextToken = crypto.randomBytes(24).toString('hex');

  process.env.WHEELSEYE_API_URL = 'https://api.wheelseye.com/currentLoc';
  process.env.WHEELSEYE_ACCESS_TOKEN = firstToken;
  delete process.env.WHEELSEYE_API_KEY;
  try {
    assert.equal(new URL(getWheelseyeUrl()).searchParams.get('accessToken'), firstToken);
    process.env.WHEELSEYE_ACCESS_TOKEN = nextToken;
    assert.equal(new URL(getWheelseyeUrl()).searchParams.get('accessToken'), nextToken);
  } finally {
    for (const [name, value] of [
      ['WHEELSEYE_API_URL', originalUrl],
      ['WHEELSEYE_ACCESS_TOKEN', originalAccessToken],
      ['WHEELSEYE_API_KEY', originalApiKey],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
