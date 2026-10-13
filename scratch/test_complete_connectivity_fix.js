const http = require('http');
const app = require('../backend/server');

const server = app.listen(5099, '127.0.0.1', async () => {
  console.log('Test server running on port 5099');

  function makeRequest(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: 5099,
          path,
          method: options.method || 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode, headers: res.headers, raw: data });
            }
          });
        }
      );
      req.on('error', reject);
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  let passed = 0;
  let failed = 0;

  function assertTest(name, condition, details = '') {
    if (condition) {
      console.log(`✅ [PASS] ${name} ${details}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} ${details}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    const health = await makeRequest('/api/health');
    assertTest('GET /api/health returns 200 OK', health.status === 200 && health.body.status === 'OK');

    // 2. CORS preflight from https://fleet.sikkaind.com
    const corsPreflightFleet = await makeRequest('/api/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://fleet.sikkaind.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization',
      },
    });
    assertTest(
      'CORS preflight for https://fleet.sikkaind.com succeeds',
      corsPreflightFleet.status === 204 && corsPreflightFleet.headers['access-control-allow-origin'] === 'https://fleet.sikkaind.com',
      `[Status: ${corsPreflightFleet.status}, Allow-Origin: ${corsPreflightFleet.headers['access-control-allow-origin']}]`
    );

    // 3. CORS preflight from Android APK (https://localhost)
    const corsPreflightApk = await makeRequest('/api/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization',
      },
    });
    assertTest(
      'CORS preflight for Android APK https://localhost succeeds',
      corsPreflightApk.status === 204 && corsPreflightApk.headers['access-control-allow-origin'] === 'https://localhost',
      `[Status: ${corsPreflightApk.status}, Allow-Origin: ${corsPreflightApk.headers['access-control-allow-origin']}]`
    );

    // 4. CORS preflight from Capacitor scheme (capacitor://localhost)
    const corsPreflightCapacitor = await makeRequest('/api/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'capacitor://localhost',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assertTest(
      'CORS preflight for capacitor://localhost succeeds',
      corsPreflightCapacitor.status === 204 && corsPreflightCapacitor.headers['access-control-allow-origin'] === 'capacitor://localhost',
      `[Status: ${corsPreflightCapacitor.status}]`
    );

    // 5. User login from https://fleet.sikkaind.com
    const userLogin = await makeRequest(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { Origin: 'https://fleet.sikkaind.com' },
      },
      { username: 'ajaysomra', password: 'Somra@2012', loginType: 'User' }
    );
    assertTest(
      'User Login with Origin https://fleet.sikkaind.com succeeds (200 OK)',
      userLogin.status === 200 && !!userLogin.body.token && userLogin.body.user.username === 'ajaysomra',
      `[User: ${userLogin.body.user?.fullName}, Role: ${userLogin.body.user?.role}]`
    );

    // 6. User profile retrieval via /api/auth/me
    const userMe = await makeRequest('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${userLogin.body.token}`,
        Origin: 'https://fleet.sikkaind.com',
      },
    });
    assertTest(
      'Profile fetch via /api/auth/me succeeds with valid token',
      userMe.status === 200 && userMe.body.user?.username === 'ajaysomra',
      `[Pages: ${userMe.body.user?.accessPages?.join(', ')}]`
    );

    // 7. Driver login from mobile APK (Origin https://localhost)
    const driverLogin = await makeRequest(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { Origin: 'https://localhost' },
      },
      {
        username: 'UP1420220001234',
        password: '9876543210',
        loginType: 'Driver',
        location: { latitude: 28.628, longitude: 77.367, accuracy: 10 },
      }
    );
    assertTest(
      'Driver Login with Origin https://localhost succeeds (200 OK)',
      driverLogin.status === 200 && !!driverLogin.body.token && driverLogin.body.user.role === 'Driver',
      `[Driver: ${driverLogin.body.user?.fullName}, DL: ${driverLogin.body.user?.username}]`
    );

    // 8. Invalid credentials returns 401 (not 500)
    const invalidLogin = await makeRequest(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { Origin: 'https://fleet.sikkaind.com' },
      },
      { username: 'ajaysomra', password: 'BadPassword999', loginType: 'User' }
    );
    assertTest(
      'Invalid password returns HTTP 401 with clear message',
      invalidLogin.status === 401 && invalidLogin.body.error === 'Invalid username or password.',
      `[Error: "${invalidLogin.body.error}"]`
    );

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    server.close(() => {
      process.exit(failed > 0 ? 1 : 0);
    });
  }
});
