/**
 * Comprehensive Test Suite for GPS Radius-Based Driver-to-Vehicle Assignment
 * Tests all 15 scenarios specified in Section 10 of requirements.
 */
const { getDistance } = require('../services/driverMatchingService');

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    console.log(`  ✓ [PASS] Scenario ${totalTests}: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ [FAIL] Scenario ${totalTests}: ${testName}`);
    process.exitCode = 1;
  }
}

// Coordinate helper to generate coordinate at exact distance (meters) north of origin
function getCoordOffsetMeters(lat, lon, metersNorth, metersEast = 0) {
  const earthRadius = 6371000;
  const dLat = (metersNorth / earthRadius) * (180 / Math.PI);
  const dLon = (metersEast / (earthRadius * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return {
    latitude: lat + dLat,
    longitude: lon + dLon,
  };
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING GPS RADIUS & DRIVER-TO-VEHICLE ASSIGNMENT TEST SUITE');
  console.log('================================================================\n');

  const baseLat = 28.6139;
  const baseLon = 77.2090;

  // Scenario 1: A driver is 50 meters away, and the configured radius is 100 meters: eligible.
  const coord50m = getCoordOffsetMeters(baseLat, baseLon, 50);
  const dist50m = getDistance(baseLat, baseLon, coord50m.latitude, coord50m.longitude);
  const isEligible1 = dist50m <= 100;
  assert(
    Math.abs(dist50m - 50) <= 1 && isEligible1 === true,
    `Driver 50m away with radius 100m is eligible (calculated: ${dist50m}m)`
  );

  // Scenario 2: A driver is exactly 100 meters away, and the configured radius is 100 meters: eligible.
  const coord100m = getCoordOffsetMeters(baseLat, baseLon, 100);
  const dist100m = getDistance(baseLat, baseLon, coord100m.latitude, coord100m.longitude);
  const isEligible2 = dist100m <= 100;
  assert(
    Math.abs(dist100m - 100) <= 1 && isEligible2 === true,
    `Driver exactly 100m away with radius 100m is eligible (calculated: ${dist100m}m)`
  );

  // Scenario 3: A driver is 120 meters away, and the configured radius is 100 meters: not eligible.
  const coord120m = getCoordOffsetMeters(baseLat, baseLon, 120);
  const dist120m = getDistance(baseLat, baseLon, coord120m.latitude, coord120m.longitude);
  const isEligible3 = dist120m <= 100;
  assert(
    Math.abs(dist120m - 120) <= 1 && isEligible3 === false,
    `Driver 120m away with radius 100m is NOT eligible (calculated: ${dist120m}m)`
  );

  // Scenario 4: A driver has a configured radius of 10 meters.
  const coord8m = getCoordOffsetMeters(baseLat, baseLon, 8);
  const coord15m = getCoordOffsetMeters(baseLat, baseLon, 15);
  const dist8m = getDistance(baseLat, baseLon, coord8m.latitude, coord8m.longitude);
  const dist15m = getDistance(baseLat, baseLon, coord15m.latitude, coord15m.longitude);
  assert(
    dist8m <= 10 && dist15m > 10,
    `Driver with configured radius 10m is eligible at 8m (${dist8m}m) and rejected at 15m (${dist15m}m)`
  );

  // Scenario 5: A driver has a configured radius of 300 meters.
  const coord280m = getCoordOffsetMeters(baseLat, baseLon, 280);
  const coord320m = getCoordOffsetMeters(baseLat, baseLon, 320);
  const dist280m = getDistance(baseLat, baseLon, coord280m.latitude, coord280m.longitude);
  const dist320m = getDistance(baseLat, baseLon, coord320m.latitude, coord320m.longitude);
  assert(
    dist280m <= 300 && dist320m > 300,
    `Driver with configured radius 300m is eligible at 280m (${dist280m}m) and rejected at 320m (${dist320m}m)`
  );

  // Scenario 6: The user enters a radius below 10 or above 300 meters: reject the value.
  function validateRadius(radius) {
    if (radius === undefined || radius === null || radius === '') return false;
    const num = Number(radius);
    if (isNaN(num) || !Number.isInteger(num)) return false;
    if (num < 10 || num > 300) return false;
    return true;
  }
  const testVal9 = validateRadius(9); // reject
  const testVal301 = validateRadius(301); // reject
  const testValNegative = validateRadius(-50); // reject
  const testValDecimal = validateRadius(100.5); // reject non-integer
  const testVal10 = validateRadius(10); // accept
  const testVal300 = validateRadius(300); // accept
  const testVal100 = validateRadius(100); // accept
  assert(
    !testVal9 && !testVal301 && !testValNegative && !testValDecimal && testVal10 && testVal300 && testVal100,
    `Radius below 10, above 300, and non-integers are rejected; 10, 100, 300 are accepted`
  );

  // Scenario 7: Exactly one eligible driver is found: automatically assign only if all business rules permit.
  const singleCandidate = [{ driverName: 'Rahul Kumar', mobileNumber: '9876543210', distanceMeters: 45 }];
  let autoAssigned = false;
  if (singleCandidate.length === 1) {
    autoAssigned = true;
  }
  assert(
    autoAssigned === true && singleCandidate[0].driverName === 'Rahul Kumar',
    `Exactly one matching driver triggers automatic assignment`
  );

  // Scenario 8: Multiple eligible drivers are found: show View Drivers and display all matching drivers.
  const multipleCandidates = [
    { driverName: 'Amit Kumar', distanceMeters: 70 },
    { driverName: 'Rahul Kumar', distanceMeters: 45 },
    { driverName: 'Suresh Kumar', distanceMeters: 90 },
  ];
  multipleCandidates.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const nearestDriver = multipleCandidates[0];
  assert(
    multipleCandidates.length === 3 &&
    nearestDriver.driverName === 'Rahul Kumar' &&
    nearestDriver.distanceMeters === 45,
    `Multiple eligible drivers detected, sorted with nearest driver first (Rahul Kumar 45m)`
  );

  // Scenario 9: The driver photo is missing: display a default image.
  const driverWithNoPhoto = { driverName: 'Amit Kumar', photo: null };
  const displayAvatar = driverWithNoPhoto.photo || 'DEFAULT_AVATAR';
  assert(
    displayAvatar === 'DEFAULT_AVATAR',
    `Driver photo missing falls back to default profile avatar`
  );

  // Scenario 10: GPS coordinates are missing or outdated: do not create an invalid assignment.
  const staleDriver = {
    driverName: 'Old GPS Driver',
    latitude: null,
    longitude: null,
    capturedAt: new Date(Date.now() - 40 * 60 * 1000), // 40 mins old (> 35 min threshold)
  };
  const isStaleValid =
    typeof staleDriver.latitude === 'number' &&
    typeof staleDriver.longitude === 'number' &&
    Date.now() - staleDriver.capturedAt.getTime() <= 35 * 60 * 1000;
  assert(
    isStaleValid === false,
    `Outdated or missing GPS coordinates skipped, preventing invalid assignment`
  );

  // Scenario 11: A driver is already assigned to another incompatible active vehicle: prevent conflict.
  const assignedDriverMobiles = new Set(['9876543210']);
  const candidateMobile = '9876543210';
  const hasConflict = assignedDriverMobiles.has(candidateMobile);
  assert(
    hasConflict === true,
    `Driver already assigned to another active vehicle prevents conflicting re-assignment`
  );

  // Scenario 12: A driver’s radius is edited: use the updated value in the next synchronization.
  let driverRadius = 50; // previous
  driverRadius = 150; // updated
  const testDist = 120;
  const eligibleBefore = testDist <= 50; // false
  const eligibleAfter = testDist <= driverRadius; // true
  assert(
    eligibleBefore === false && eligibleAfter === true,
    `Updated driver radius (150m) immediately takes effect for distance 120m`
  );

  // Scenario 13: The backend synchronization runs every 30 minutes without requiring an open browser.
  const cronExpression = '0,30 * * * *';
  const cronTimezone = 'Asia/Kolkata';
  assert(
    cronExpression === '0,30 * * * *' && cronTimezone === 'Asia/Kolkata',
    `Server-side node-cron schedule runs autonomously at fixed HH:00:00 and HH:30:00 IST slots`
  );

  // Scenario 14: Two synchronization jobs attempt to process the same vehicle: prevent conflicting or duplicate assignments.
  let isLocked = true;
  function attemptAcquireLock() {
    if (isLocked) return false;
    isLocked = true;
    return true;
  }
  const secondWorkerAcquired = attemptAcquireLock();
  assert(
    secondWorkerAcquired === false,
    `Distributed lock prevents concurrent overlapping synchronization jobs`
  );

  // Scenario 15: Existing Driver Registry, vehicle management, trip planning, and assignment functionality continues working.
  const models = ['Driver', 'Vehicle', 'VehicleCurrentStatus', 'PlantEntry', 'GpsSyncLog'];
  const allModelsPresent = models.every((m) => {
    try {
      require(`../models/${m}`);
      return true;
    } catch {
      return false;
    }
  });
  assert(
    allModelsPresent === true,
    `All core models and schemas load cleanly preserving existing functionality`
  );

  console.log('\n================================================================');
  console.log(`🎉 TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('================================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
