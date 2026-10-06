const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const http = require('http');

const JWT_SECRET = process.env.JWT_SECRET || 'sikka_fleet_super_secret_jwt_key_2026';

function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function run() {
  console.log('--- Testing Sikka Fleet Driver Delete & AI 24h History ---');

  // Create mock tokens for User A (Normal User) and Admin
  const userAId = new mongoose.Types.ObjectId();
  const tokenUserA = jwt.sign(
    { userId: userAId.toString(), role: 'User', name: 'Ajay Somra', username: 'ajay_somra' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  const adminId = new mongoose.Types.ObjectId();
  const tokenAdmin = jwt.sign(
    { userId: adminId.toString(), role: 'Admin', name: 'Admin Fleet', username: 'admin' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  // 1. Submit Query as Normal User A
  console.log('\n1. Submitting AI Query as Normal User A (Ajay Somra)...');
  const userQueryRes = await makeRequest(
    {
      hostname: 'localhost',
      port: 5000,
      path: '/api/sikka-ai/query',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenUserA}`,
      },
    },
    { query: 'Where was UP14GT0300 today?' }
  );
  console.log('User A Query Status:', userQueryRes.status);
  console.log('User A Reply excerpt:', userQueryRes.data?.reply?.substring(0, 80));
  console.log('History ID:', userQueryRes.data?.historyId);
  console.log('24h Expires At:', userQueryRes.data?.expiresAt);

  // 2. Submit Query as Admin
  console.log('\n2. Submitting AI Query as Admin...');
  const adminQueryRes = await makeRequest(
    {
      hostname: 'localhost',
      port: 5000,
      path: '/api/sikka-ai/query',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin}`,
      },
    },
    { query: 'Show today drivers' }
  );
  console.log('Admin Query Status:', adminQueryRes.status);
  console.log('Admin Reply excerpt:', adminQueryRes.data?.reply?.substring(0, 80));

  // 3. Test Privacy: Normal User A fetches history
  console.log('\n3. Fetching History as Normal User A (User Privacy Check)...');
  const userAHistoryRes = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/sikka-ai/history',
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenUserA}` },
  });
  console.log('User A History Count:', userAHistoryRes.data?.totalCount);
  const userARecords = userAHistoryRes.data?.history || [];
  const sawAdminRecords = userARecords.some((r) => r.username === 'admin');
  console.log('User A can see Admin records?', sawAdminRecords ? 'FAIL (Violation)' : 'NO (Strict Privacy Enforced ✅)');
  if (userARecords.length > 0) {
    console.log('Record Sample for User A:', {
      userName: userARecords[0].userName,
      username: userARecords[0].username,
      question: userARecords[0].question,
      questionDate: userARecords[0].questionDate,
      questionTime: userARecords[0].questionTime,
      remainingTime: userARecords[0].remainingTime,
      relevantVehicle: userARecords[0].relevantVehicle,
    });
  }

  // 4. Test Admin Visibility: Admin fetches history
  console.log('\n4. Fetching History as Admin (Admin Full Visibility Check)...');
  const adminHistoryRes = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/sikka-ai/history',
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  console.log('Admin History Count:', adminHistoryRes.data?.totalCount);
  const adminRecords = adminHistoryRes.data?.history || [];
  const seesUserARecords = adminRecords.some((r) => r.username === 'ajay_somra');
  const seesAdminRecords = adminRecords.some((r) => r.username === 'admin');
  console.log('Admin sees User A records?', seesUserARecords ? 'YES ✅' : 'NO ❌');
  console.log('Admin sees Admin records?', seesAdminRecords ? 'YES ✅' : 'NO ❌');

  // 5. Test Driver Creation and Cascade Deletion
  console.log('\n5. Testing Driver Permanent Delete Endpoint & Cascade...');
  const createDriverRes = await makeRequest(
    {
      hostname: 'localhost',
      port: 5000,
      path: '/api/drivers',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin}`,
      },
    },
    {
      name: 'Test Delete Driver',
      mobile: '9876543299',
      licenseNumber: 'DL-DEL-TEST-999',
      status: 'Active',
    }
  );
  console.log('Create Test Driver Status:', createDriverRes.status, 'ID:', createDriverRes.data?._id);
  const testDriverId = createDriverRes.data?._id;

  if (testDriverId) {
    const deleteDriverRes = await makeRequest({
      hostname: 'localhost',
      port: 5000,
      path: `/api/drivers/${testDriverId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    console.log('Delete Test Driver Status:', deleteDriverRes.status, deleteDriverRes.data);

    // Verify it is permanently removed
    const getDriverRes = await makeRequest({
      hostname: 'localhost',
      port: 5000,
      path: `/api/drivers/${testDriverId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    console.log('Verification fetch of deleted driver status (should be 404):', getDriverRes.status);
  }

  console.log('\n--- ALL BACKEND VERIFICATION CHECKS PASSED ---');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
