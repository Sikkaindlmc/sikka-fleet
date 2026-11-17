const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDashboardEligibleGpsVehicle,
  isVerifiedGpsSample,
} = require('../services/gpsDataService');

test('dashboard GPS widgets include only active, registered vehicles with GPS data', () => {
  const eligible = {
    isRegistered: true,
    hasGps: true,
    vehicle: { status: 'Active' },
  };
  assert.equal(isDashboardEligibleGpsVehicle(eligible), true);
  assert.equal(isDashboardEligibleGpsVehicle({ ...eligible, vehicle: { status: 'Inactive' } }), false);
  assert.equal(isDashboardEligibleGpsVehicle({ ...eligible, isRegistered: false }), false);
  assert.equal(isDashboardEligibleGpsVehicle({ ...eligible, hasGps: false }), false);
});

test('old GPS samples are only trusted if fresh when they were fetched', () => {
  const syncTime = new Date('2026-11-17T07:30:00Z');
  assert.equal(isVerifiedGpsSample({
    gpsTimestamp: new Date('2026-11-17T07:10:00Z'),
    syncTime,
  }), true);
  assert.equal(isVerifiedGpsSample({
    gpsTimestamp: new Date('2026-11-17T06:59:00Z'),
    syncTime,
  }), false);
  assert.equal(isVerifiedGpsSample({
    gpsTimestamp: new Date('2026-11-17T07:10:00Z'),
    syncTime,
    statusEligible: false,
  }), false);
});
