const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '..', '.env');
const env = fs.existsSync(envPath)
  ? dotenv.parse(fs.readFileSync(envPath))
  : {};
const secretValues = Object.values(env).filter((value) => value && value.length >= 4);

function isConfigured(name) {
  return Boolean(String(env[name] || '').trim());
}

function selectedValue(names) {
  return names.find((name) => isConfigured(name));
}

function redact(value) {
  let text = String(value ?? '');
  for (const secret of secretValues) {
    text = text.split(secret).join('[REDACTED]');
  }
  return text
    .replace(/(access[_-]?token|refresh[_-]?token|password|authorization|api[_-]?key)(["':=\s]+)[^,;\s"'}]+/gi, '$1$2[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:accessToken|access_token|token|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 240);
}

function safeResponseBody(data) {
  if (typeof data === 'string') {
    return redact(data) || '(empty body)';
  }
  if (Array.isArray(data)) {
    return `Array response (${data.length} records; record contents omitted)`;
  }
  if (!data || typeof data !== 'object') {
    return data === undefined || data === null ? '(empty body)' : redact(data);
  }

  const safeFields = {};
  for (const key of ['message', 'error', 'status', 'success', 'code', 'detail']) {
    if (typeof data[key] === 'string' || typeof data[key] === 'number' || typeof data[key] === 'boolean') {
      safeFields[key] = redact(data[key]);
    }
  }
  if (Object.keys(safeFields).length) return JSON.stringify(safeFields).slice(0, 240);
  return `JSON object (fields: ${Object.keys(data).slice(0, 12).join(', ') || 'none'}; values omitted)`;
}

function reportEnvironment(provider, names) {
  console.log(`\n${provider} environment variables:`);
  for (const name of names) {
    console.log(`  ${name}: ${isConfigured(name) ? 'not empty' : 'EMPTY'}`);
  }
}

function reportHttp(label, status, body) {
  console.log(`${label} HTTP status: ${status ?? 'not requested'}`);
  console.log(`${label} response body: ${safeResponseBody(body)}`);
}

function errorBody(error) {
  return error.response?.data ?? error.code ?? 'No response body';
}

async function testWheelsEye() {
  const urlName = isConfigured('WHEELSEYE_API_URL') ? 'WHEELSEYE_API_URL' : null;
  const tokenName = selectedValue(['WHEELSEYE_ACCESS_TOKEN', 'WHEELSEYE_API_KEY']);
  const configuredUrl = String(env.WHEELSEYE_API_URL || '').trim();
  const endpoint = configuredUrl || 'https://api.wheelseye.com/currentLoc';
  const requestUrl = new URL(endpoint);
  let authPlacement = 'configured URL as-is';

  if (!configuredUrl) {
    authPlacement = 'query parameter accessToken';
    if (tokenName) requestUrl.searchParams.set('accessToken', env[tokenName]);
  }
  const queryNames = [...requestUrl.searchParams.keys()];

  console.log('\nWheelsEye request:');
  console.log(`  URL source: ${urlName || 'default currentLoc endpoint'}`);
  console.log(`  Token source: ${tokenName || 'none configured'}`);
  console.log(`  App auth placement: ${authPlacement}`);
  console.log(`  Configured URL query parameter names: ${queryNames.join(', ') || 'none'}`);
  console.log('  Authorization header: not used');
  if (!tokenName && !new URL(endpoint).searchParams.has('accessToken')) {
    reportHttp('WheelsEye', null, 'Request skipped: no token configured');
    return;
  }

  try {
    const response = await axios.get(requestUrl.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': 'SikkaFleet-GpsDiagnostic/1.0' },
      timeout: 15000,
    });
    reportHttp('WheelsEye', response.status, response.data);
  } catch (error) {
    reportHttp('WheelsEye', error.response?.status ?? error.code ?? 'network error', errorBody(error));
  }
}

async function testFleetX() {
  const baseUrl = String(
    env.FLEETX_API_BASE_URL || env.FLEETX_BASE_URL || 'https://api.fleetx.io'
  ).trim().replace(/\/$/, '');
  const basicAuthName = selectedValue(['FLEETX_BASIC_AUTH']);
  const usernameName = selectedValue(['FLEETX_USERNAME']);
  const passwordName = selectedValue(['FLEETX_PASSWORD']);
  if (!basicAuthName || !usernameName || !passwordName) {
    reportHttp('FleetX login', null, 'Request skipped: required credentials are empty');
    return;
  }

  console.log('\nFleetX authentication: Basic Authorization header on login');
  const form = new FormData();
  form.append('username', env[usernameName]);
  form.append('password', env[passwordName]);
  form.append('grant_type', 'password');

  let token;
  try {
    const response = await axios.post(`${baseUrl}/api/v1/login`, form, {
      headers: {
        Authorization: env[basicAuthName].startsWith('Basic ')
          ? env[basicAuthName]
          : `Basic ${env[basicAuthName]}`,
        ...form.getHeaders(),
      },
      timeout: 15000,
    });
    reportHttp('FleetX login', response.status, response.data);
    token = response.data?.access_token || response.data?.accessToken || response.data?.token;
    if (!token) {
      console.log('FleetX live API: not requested (login returned no token)');
      return;
    }
    secretValues.push(String(token));
  } catch (error) {
    reportHttp('FleetX login', error.response?.status ?? error.code ?? 'network error', errorBody(error));
    console.log('FleetX live API: not requested (login failed)');
    return;
  }

  try {
    console.log('FleetX live API authorization: Bearer token in Authorization header');
    const response = await axios.get(`${baseUrl}/api/v1/analytics/live`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      timeout: 15000,
    });
    reportHttp('FleetX live API', response.status, response.data);
    const data = response.data;
    const vehicles = Array.isArray(data)
      ? data
      : data?.vehicles || data?.data?.vehicles || data?.data || data?.list;
    console.log(`FleetX live vehicles returned: ${Array.isArray(vehicles) ? vehicles.length : 'response shape not recognized'}`);
  } catch (error) {
    reportHttp('FleetX live API', error.response?.status ?? error.code ?? 'network error', errorBody(error));
  }
}

async function main() {
  console.log('GPS provider diagnostic (reads backend/.env; credential values are never printed)');
  reportEnvironment('WheelsEye', [
    'WHEELSEYE_API_URL',
    'WHEELSEYE_ACCESS_TOKEN',
    'WHEELSEYE_API_KEY',
  ]);
  reportEnvironment('FleetX', [
    'FLEETX_API_BASE_URL',
    'FLEETX_BASE_URL',
    'FLEETX_USERNAME',
    'FLEETX_PASSWORD',
    'FLEETX_BASIC_AUTH',
  ]);

  await testWheelsEye();
  await testFleetX();
}

main().catch((error) => {
  console.error(`Diagnostic failed safely: ${error.code || 'UNEXPECTED_ERROR'}`);
  process.exitCode = 1;
});
