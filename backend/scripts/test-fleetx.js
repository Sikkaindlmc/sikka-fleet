const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const axios = require('axios');
const FormData = require('form-data');

function sanitizeValue(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(access[_-]?token|refresh[_-]?token|password|authorization)[\"':=\s]*[^,;\s]+/gi, '$1: [REDACTED]');
}

function printObject(label, value) {
  console.log(`\n${label}`);
  if (!value || typeof value !== 'object') {
    console.log(sanitizeValue(value));
    return;
  }
  console.log(JSON.stringify(value, (key, nestedValue) => {
    if (/^(access_?token|refresh_?token|password|authorization)$/i.test(key)) return '[REDACTED]';
    return sanitizeValue(nestedValue);
  }, 2));
}

async function main() {
  console.log('========== FLEETX API DIAGNOSTIC ==========');

  const baseUrl = (process.env.FLEETX_API_BASE_URL || 'https://api.fleetx.io').trim().replace(/\/$/, '');
  const basicAuth = (process.env.FLEETX_BASIC_AUTH || '').trim();
  const username = (process.env.FLEETX_USERNAME || '').trim();
  const password = (process.env.FLEETX_PASSWORD || '').trim();
  const credentialsLoaded = Boolean(baseUrl && basicAuth && username && password);

  console.log('\n1. ENVIRONMENT');
  console.log(`Credentials Loaded: ${credentialsLoaded ? 'YES' : 'NO'}`);
  console.log(`Username Configured: ${username ? 'YES' : 'NO'}`);
  console.log(`Password Configured: ${password ? 'YES' : 'NO'}`);
  console.log(`Basic Authorization Configured: ${basicAuth ? 'YES' : 'NO'}`);

  if (!credentialsLoaded) {
    console.log('\n7. RESULT');
    console.log('FleetX API: FAILED');
    console.log('Reason: One or more required FleetX environment variables are missing.');
    process.exitCode = 1;
    return;
  }

  const loginUrl = `${baseUrl}/api/v1/login`;
  let loginResponse;
  try {
    const form = new FormData();
    form.append('username', username);
    form.append('password', password);
    form.append('grant_type', 'password');

    loginResponse = await axios.post(loginUrl, form, {
      headers: {
        Authorization: basicAuth.startsWith('Basic ') ? basicAuth : `Basic ${basicAuth}`,
        ...form.getHeaders(),
      },
      timeout: 15000,
    });
  } catch (error) {
    const status = error.response?.status || 'N/A';
    const body = error.response?.data || { error: error.code || error.message };
    console.log('\n2. LOGIN API');
    console.log('Endpoint: /api/v1/login');
    console.log(`HTTP Status: ${status}`);
    console.log('Login Successful: NO');
    console.log('Access Token Returned: NO');
    console.log('Token Value: HIDDEN');
    printObject('Sanitized Response:', body);
    console.log('\n7. RESULT');
    console.log('FleetX API: FAILED');
    process.exitCode = 1;
    return;
  }

  const loginData = loginResponse.data || {};
  const token = loginData.access_token || loginData.accessToken || loginData.token || '';

  console.log('\n2. LOGIN API');
  console.log('Endpoint: /api/v1/login');
  console.log(`HTTP Status: ${loginResponse.status}`);
  console.log(`Login Successful: ${token ? 'YES' : 'NO'}`);
  console.log(`Access Token Returned: ${token ? 'YES' : 'NO'}`);
  console.log('Token Value: HIDDEN');
  printObject('Login Raw Fields:', loginData);

  if (!token) {
    console.log('\n7. RESULT');
    console.log('FleetX API: FAILED');
    console.log('Reason: Login response did not contain an access token.');
    process.exitCode = 1;
    return;
  }

  const liveUrl = `${baseUrl}/api/v1/analytics/live`;
  let liveResponse;
  try {
    liveResponse = await axios.get(liveUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      timeout: 15000,
    });
  } catch (error) {
    const status = error.response?.status || 'N/A';
    const body = error.response?.data || { error: error.code || error.message };
    console.log('\n3. LIVE GPS API');
    console.log('Endpoint: /api/v1/analytics/live');
    console.log(`HTTP Status: ${status}`);
    console.log('API Successful: NO');
    printObject('Sanitized Response:', body);
    console.log('\n7. RESULT');
    console.log('FleetX API: FAILED');
    process.exitCode = 1;
    return;
  }

  const payload = liveResponse.data;
  const vehicles = Array.isArray(payload)
    ? payload
    : payload?.vehicles
      || payload?.data?.vehicles
      || payload?.data
      || payload?.list
      || [];
  const records = Array.isArray(vehicles) ? vehicles : [];

  console.log('\n3. LIVE GPS API');
  console.log('Endpoint: /api/v1/analytics/live');
  console.log(`HTTP Status: ${liveResponse.status}`);
  console.log('API Successful: YES');

  console.log('\n4. VEHICLE RECORDS');
  console.log(`Total Vehicles Returned: ${records.length}`);

  console.log('\n5. FIRST VEHICLE RAW RESPONSE');
  printObject('First Record:', records[0] || null);

  console.log('\n6. SECOND VEHICLE RAW RESPONSE');
  printObject('Second Record:', records[1] || null);

  console.log('\n7. RESULT');
  console.log('FleetX API: SUCCESS');
  console.log('==========================================');
}

main().catch((error) => {
  console.error('\n[Unexpected FleetX Diagnostic Error]:', error.message);
  process.exitCode = 1;
});
