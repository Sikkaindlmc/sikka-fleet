const https = require('https');
const assert = require('assert');

const CLOUD_URL = 'https://sikka-fleet.vercel.app/api';

function request(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `${CLOUD_URL}${path}`);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      timeout: 15000,
    };

    if (body) {
      const jsonBody = typeof body === 'string' ? body : JSON.stringify(body);
      reqOptions.headers['Content-Length'] = Buffer.byteLength(jsonBody);
    }

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=================================================================');
  console.log('🧪 SIKKA FLEET PRODUCTION & UNIVERSAL LOGIN VERIFICATION SUITE');
  console.log(`📡 Target Endpoint: ${CLOUD_URL}`);
  console.log('=================================================================\n');

  let passed = 0;
  let failed = 0;

  function report(name, condition, details = '') {
    if (condition) {
      console.log(`✅ [PASS] ${name} ${details}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} ${details}`);
      failed++;
    }
  }

  try {
    // 1. Health check & Server accessibility test
    console.log('--- 1. Health Check & Cloud Connectivity ---');
    const health = await request('/health');
    report(
      'Cloud Health Check Endpoint responds with 200 OK',
      health.status === 200 && health.data.status === 'OK',
      `[${health.data.application || 'OK'}]`
    );

    // 2. User login (Web origin simulation: https://sikka-fleet.vercel.app)
    console.log('\n--- 2. User Login (Web Application Wi-Fi / Remote) ---');
    const userWebLogin = await request(
      '/auth/login',
      {
        method: 'POST',
        headers: { Origin: 'https://sikka-fleet.vercel.app' },
      },
      { username: 'ajaysomra', password: 'Somra@2012', loginType: 'User' }
    );
    report(
      'User Web Login succeeds (HTTP 200) with valid token and user profile',
      userWebLogin.status === 200 && !!userWebLogin.data.token && userWebLogin.data.user.role === 'Admin',
      `[User: ${userWebLogin.data.user?.fullName}, Role: ${userWebLogin.data.user?.role}]`
    );
    const userToken = userWebLogin.data.token;

    // 3. User profile verification via /auth/me
    console.log('\n--- 3. User Authorized Access (/auth/me) ---');
    const userMe = await request('/auth/me', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    report(
      'User token valid for /auth/me and retrieves permissions',
      userMe.status === 200 && userMe.data.user?.username === 'ajaysomra',
      `[Pages: ${userMe.data.user?.accessPages?.join(', ')}]`
    );

    // 4. Driver login (Web simulation with coordinates)
    console.log('\n--- 4. Driver Login (Web Application with location) ---');
    const driverWebLogin = await request(
      '/auth/login',
      {
        method: 'POST',
        headers: { Origin: 'https://sikka-fleet.vercel.app' },
      },
      {
        username: 'UP1420220001234',
        password: '9876543210',
        loginType: 'Driver',
        location: { latitude: 28.628, longitude: 77.367, accuracy: 25 },
      }
    );
    report(
      'Driver Web Login succeeds (HTTP 200) with valid token and role',
      driverWebLogin.status === 200 && !!driverWebLogin.data.token && driverWebLogin.data.user.role === 'Driver',
      `[Driver: ${driverWebLogin.data.user?.fullName}, DL: ${driverWebLogin.data.user?.username}]`
    );
    const driverToken = driverWebLogin.data.token;

    // 5. Driver login (Android APK Capacitor simulation: Origin https://localhost)
    console.log('\n--- 5. Driver Login (Android APK Simulation: Origin https://localhost) ---');
    const driverApkLogin = await request(
      '/auth/login',
      {
        method: 'POST',
        headers: { Origin: 'https://localhost' },
      },
      {
        username: 'UP1420220001234',
        password: '9876543210',
        loginType: 'Driver',
        location: { latitude: 28.628, longitude: 77.367, accuracy: 15 },
      }
    );
    report(
      'Driver Android APK Login succeeds from https://localhost origin',
      driverApkLogin.status === 200 && !!driverApkLogin.data.token,
      `[Token received: ${driverApkLogin.data.token.substring(0, 25)}...]`
    );

    // 6. User login (Android APK Capacitor simulation: Origin https://localhost)
    console.log('\n--- 6. User Login (Android APK Simulation: Origin https://localhost) ---');
    const userApkLogin = await request(
      '/auth/login',
      {
        method: 'POST',
        headers: { Origin: 'https://localhost' },
      },
      { username: 'ajaysomra', password: 'Somra@2012', loginType: 'User' }
    );
    report(
      'User Android APK Login succeeds from https://localhost origin',
      userApkLogin.status === 200 && !!userApkLogin.data.token,
      `[User: ${userApkLogin.data.user?.fullName}]`
    );

    // 7. SIM Cellular data simulation (No origin header, native mobile HTTP stack)
    console.log('\n--- 7. Cellular 4G/5G SIM Data Simulation (Native Mobile stack, No Origin) ---');
    const cellularLogin = await request(
      '/auth/login',
      { method: 'POST', headers: {} },
      { username: 'UP1420220001234', password: '9876543210', loginType: 'Driver' }
    );
    report(
      'Driver Login succeeds over native SIM data without Origin header',
      cellularLogin.status === 200 && !!cellularLogin.data.token,
      `[Driver DL: ${cellularLogin.data.user?.username}]`
    );

    // 8. Driver self-service endpoint (/api/drivers/my-status)
    console.log('\n--- 8. Driver Telematics Authorized Services ---');
    const driverStatus = await request('/drivers/my-status', {
      headers: { Authorization: `Bearer ${driverToken}` },
    });
    report(
      'Driver accesses telematics self-status (/api/drivers/my-status)',
      driverStatus.status === 200 && driverStatus.data.driver?.dlNumber === 'UP1420220001234',
      `[Status: ${driverStatus.data.currentStatus || 'Active'}]`
    );

    // 9. Role-based security: Driver blocked from unauthorized Admin Registry
    console.log('\n--- 9. Role-Based Access Control (RBAC) Enforcement ---');
    const driverAdminAccess = await request('/drivers', {
      headers: { Authorization: `Bearer ${driverToken}` },
    });
    report(
      'Driver is correctly blocked (HTTP 403) from administrative Driver Registry',
      driverAdminAccess.status === 403,
      `[Expected 403, Got ${driverAdminAccess.status}]`
    );

    // 10. Admin can access full Driver Registry
    const adminDriverAccess = await request('/drivers', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    report(
      'Admin can access administrative Driver Registry',
      adminDriverAccess.status === 200 && Array.isArray(adminDriverAccess.data.drivers),
      `[Found ${adminDriverAccess.data.totalCount} driver(s)]`
    );

    // 11. Invalid credentials handling (Both User and Driver)
    console.log('\n--- 11. Error Handling & Invalid Credentials ---');
    const invalidUser = await request(
      '/auth/login',
      { method: 'POST' },
      { username: 'ajaysomra', password: 'WrongPassword999', loginType: 'User' }
    );
    report(
      'Invalid password returns 401 Unauthorized for User',
      invalidUser.status === 401 && invalidUser.data.error.includes('Invalid'),
      `[Error: "${invalidUser.data.error}"]`
    );

    const invalidDriver = await request(
      '/auth/login',
      { method: 'POST' },
      { username: 'UP1420220001234', password: '1111111111', loginType: 'Driver' }
    );
    report(
      'Invalid mobile returns 401 Unauthorized for Driver',
      invalidDriver.status === 401 && invalidDriver.data.error.includes('Invalid'),
      `[Error: "${invalidDriver.data.error}"]`
    );

    // 12. Simultaneous Web and APK Access (Concurrency)
    console.log('\n--- 12. Simultaneous Concurrent Web and Mobile APK Access ---');
    const [concurrentWeb, concurrentApk] = await Promise.all([
      request('/auth/me', { headers: { Authorization: `Bearer ${userToken}` } }),
      request('/drivers/my-status', { headers: { Authorization: `Bearer ${driverToken}` } }),
    ]);
    report(
      'Simultaneous Web and APK requests succeed concurrently',
      concurrentWeb.status === 200 && concurrentApk.status === 200,
      `[Web: HTTP ${concurrentWeb.status}, APK: HTTP ${concurrentApk.status}]`
    );

    // 13. Verification that production requests do not use LAN IP addresses
    console.log('\n--- 13. Production Endpoint IP Verification ---');
    report(
      'Production URL is secure HTTPS and contains no private LAN IP',
      CLOUD_URL.startsWith('https://') && !CLOUD_URL.includes('192.168.') && !CLOUD_URL.includes('localhost'),
      `[Verified: ${CLOUD_URL}]`
    );

    console.log('\n=================================================================');
    console.log(`SUMMARY: ${passed} Passed, ${failed} Failed`);
    console.log('=================================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test Suite encountered fatal error:', err);
    process.exit(1);
  }
}

runTests();
