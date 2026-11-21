const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const axios = require('axios');

async function main() {
  const startedAt = Date.now();
  const apiUrl = (process.env.WHEELSEYE_API_URL || '').trim();
  const token = (process.env.WHEELSEYE_API_KEY || process.env.WHEELSEYE_ACCESS_TOKEN || '').trim();
  let parsedUrl = null;
  try {
    parsedUrl = new URL(apiUrl);
  } catch (_) {}

  console.log('========== WHEELSEYE API DIAGNOSTIC ==========');
  console.log(`Endpoint: ${parsedUrl ? 'https://api.wheelseye.com/currentLoc' : 'NOT CONFIGURED'}`);
  console.log(`Credentials Loaded: ${apiUrl || token ? 'YES' : 'NO'}`);
  console.log(`Authorization Format: accessToken query parameter`);
  console.log(`Response Time: MEASURING`);

  if (!apiUrl && !token) {
    console.log('HTTP Status: N/A');
    console.log('Authentication Result: FAILED');
    console.log('Vehicle Count: 0');
    console.log('Result: WHEELSEYE FAILED - WHEELSEYE_API_URL or WHEELSEYE_ACCESS_TOKEN is missing');
    process.exitCode = 1;
    return;
  }

  const requestUrl = new URL(apiUrl || 'https://api.wheelseye.com/currentLoc');
  if (token) requestUrl.searchParams.set('accessToken', token);

  try {
    const response = await axios.get(requestUrl.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': 'SikkaFleet-Diagnostic/1.0' },
      timeout: 15000,
    });
    const list = response.data?.data?.list
      || response.data?.list
      || (Array.isArray(response.data) ? response.data : []);
    console.log(`HTTP Status: ${response.status}`);
    console.log(`Authentication Result: ${response.status >= 200 && response.status < 300 ? 'VALID' : 'FAILED'}`);
    console.log(`Response Time: ${Date.now() - startedAt}ms`);
    console.log(`Vehicle Count: ${list.length}`);
    console.log('First Vehicle Raw Fields:', list[0] ? JSON.stringify(Object.keys(list[0])) : '[]');
    console.log('Second Vehicle Raw Fields:', list[1] ? JSON.stringify(Object.keys(list[1])) : '[]');
    console.log(`Result: ${list.length >= 0 ? 'SUCCESS' : 'FAILED'}`);
  } catch (error) {
    console.log(`HTTP Status: ${error.response?.status || 'N/A'}`);
    console.log(`Authentication Result: ${error.response?.status === 401 ? 'INVALID / EXPIRED' : 'FAILED'}`);
    console.log(`Response Time: ${Date.now() - startedAt}ms`);
    console.log(`Vehicle Count: 0`);
    const body = error.response?.data;
    console.log('Sanitized Error:', typeof body === 'string'
      ? body
      : JSON.stringify(body?.message || body?.error || error.code || error.message));
  }
  console.log('============================================');
}

main();
