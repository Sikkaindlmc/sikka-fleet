const path = require('path');
const jwt = require('jsonwebtoken');
const connectDB = require(path.join(__dirname, '../backend/config/db'));
const Vehicle = require(path.join(__dirname, '../backend/models/Vehicle'));
const User = require(path.join(__dirname, '../backend/models/User'));
const GpsSetting = require(path.join(__dirname, '../backend/models/GpsSetting'));
const app = require(path.join(__dirname, '../backend/server'));
const http = require('http');

let server;

function makeRequest(port, method, pathStr, token, data) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : '';
    const headers = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (postData) headers['Content-Length'] = Buffer.byteLength(postData);

    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: pathStr,
        method,
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, data: body });
          }
        });
      }
    );
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

(async () => {
  try {
    await connectDB();
    const PORT = 5055;
    server = app.listen(PORT);

    // Get an admin user for token
    let admin = await User.findOne({ role: 'Super Admin' });
    if (!admin) admin = await User.findOne();
    const token = jwt.sign(
      { id: admin._id, username: admin.username, role: admin.role, permissions: admin.permissions || [] },
      process.env.JWT_SECRET || 'sikka_fleet_super_secret_jwt_key_2026',
      { expiresIn: '1h' }
    );

    console.log('--- TEST 1: Check Current Registered Vehicles in DB ---');
    const getRes = await makeRequest(PORT, 'GET', '/api/vehicles', token);
    console.log(`Status: ${getRes.status}, Total vehicles: ${getRes.data.length}`);
    if (getRes.status !== 200 || !Array.isArray(getRes.data)) {
      throw new Error('Failed to fetch vehicles');
    }

    console.log('--- TEST 2: Check Live Vehicles GPS Endpoint ---');
    const gpsRes = await makeRequest(PORT, 'GET', '/api/gps/live-vehicles', token);
    console.log(`Status: ${gpsRes.status}, Total live vehicles returned: ${gpsRes.data.vehicles.length}`);
    if (gpsRes.status !== 200) {
      throw new Error('Failed to fetch live vehicles');
    }

    console.log('--- TEST 3: Test Inactive Vehicle GPS Exclusion ---');
    // Pick the first vehicle and set it to Inactive
    const testVeh = getRes.data[0];
    console.log(`Setting vehicle ${testVeh.vehicleNumber} to Inactive...`);
    const updateRes = await makeRequest(PORT, 'PUT', `/api/vehicles/${testVeh._id}`, token, {
      vehicleNumber: testVeh.vehicleNumber,
      driverName: testVeh.driverName || '',
      mobile: testVeh.mobile || '',
      fleetType: testVeh.fleetType,
      ownerName: testVeh.ownerName || '',
      status: 'Inactive',
    });
    console.log('Update status:', updateRes.status, 'New vehicle status:', updateRes.data.vehicle.status);

    const gpsAfterInactive = await makeRequest(PORT, 'GET', '/api/gps/live-vehicles', token);
    const isInactivePresent = gpsAfterInactive.data.vehicles.some(
      (v) => v.vehicleNumber.toUpperCase() === testVeh.vehicleNumber.toUpperCase()
    );
    console.log(`Is Inactive vehicle ${testVeh.vehicleNumber} present in GPS live stream?: ${isInactivePresent}`);
    if (isInactivePresent) {
      throw new Error('Inactive vehicle should NOT be displayed in GPS live vehicles!');
    }
    console.log('SUCCESS: Inactive vehicle GPS location display is stopped!');

    // Restore to Active
    await makeRequest(PORT, 'PUT', `/api/vehicles/${testVeh._id}`, token, {
      vehicleNumber: testVeh.vehicleNumber,
      driverName: testVeh.driverName || '',
      mobile: testVeh.mobile || '',
      fleetType: testVeh.fleetType,
      ownerName: testVeh.ownerName || '',
      status: 'Active',
    });
    console.log(`Restored ${testVeh.vehicleNumber} back to Active.`);

    console.log('--- TEST 4: Test Vehicle Creation & Deletion with GPS Stop ---');
    const createRes = await makeRequest(PORT, 'POST', '/api/vehicles', token, {
      vehicleNumber: 'TEST99DEL01',
      driverName: 'Temp Driver',
      mobile: '9876543210',
      fleetType: 'Own Fleet',
      status: 'Active',
    });
    console.log('Create vehicle status:', createRes.status, 'Created ID:', createRes.data.vehicle._id);
    const createdId = createRes.data.vehicle._id;

    // Now delete this vehicle via DELETE /api/vehicles/:id
    const deleteRes = await makeRequest(PORT, 'DELETE', `/api/vehicles/${createdId}`, token);
    console.log('Delete status:', deleteRes.status, 'Response:', deleteRes.data);
    if (deleteRes.status !== 200) {
      throw new Error('Failed to delete vehicle');
    }

    // Verify it is not in /api/vehicles
    const getAfterDelete = await makeRequest(PORT, 'GET', '/api/vehicles', token);
    const isDeletedPresent = getAfterDelete.data.some((v) => v.vehicleNumber === 'TEST99DEL01');
    console.log('Is deleted vehicle still present in registry?:', isDeletedPresent);
    if (isDeletedPresent) {
      throw new Error('Deleted vehicle should not be in registry!');
    }

    // Verify it is not in GPS live vehicles
    const gpsAfterDelete = await makeRequest(PORT, 'GET', '/api/gps/live-vehicles', token);
    const isDeletedInGps = gpsAfterDelete.data.vehicles.some((v) => v.vehicleNumber === 'TEST99DEL01');
    console.log('Is deleted vehicle present in GPS stream?:', isDeletedInGps);
    if (isDeletedInGps) {
      throw new Error('Deleted vehicle should not be in GPS live vehicles!');
    }
    console.log('SUCCESS: Delete endpoint works and stops GPS tracking completely!');

    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    if (server) server.close();
    process.exit(1);
  }
})();
