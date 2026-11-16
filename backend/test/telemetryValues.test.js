const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTelemetryNumber,
  parseTelemetryBoolean,
  normalizeVendorMovementStatus,
  resolveMovementStatus,
} = require('../services/telemetryValues');
const {
  normalizeWheelseyeItem,
  normalizeFleetxItem,
  parseTelematicsTimestamp,
} = require('../services/gpsSyncService');
const {
  calculateStayDuration,
  getPlantRadiusMeters,
  getVehiclePlantStatus,
} = require('../services/geofenceService');
const Plant = require('../models/Plant');

test('preserves absent and invalid telemetry instead of coercing to zero or false', () => {
  assert.equal(parseTelemetryNumber(undefined), null);
  assert.equal(parseTelemetryNumber('not-a-number'), null);
  assert.equal(parseTelemetryNumber('0'), 0);
  assert.equal(parseTelemetryBoolean('false'), false);
  assert.equal(parseTelemetryBoolean('0'), false);
  assert.equal(parseTelemetryBoolean('true'), true);
  assert.equal(parseTelemetryBoolean(undefined), null);
});

test('maps vendor movement status and otherwise applies ignition and noise threshold', () => {
  assert.equal(normalizeVendorMovementStatus('RUNNING'), 'Moving');
  assert.equal(normalizeVendorMovementStatus('parked'), 'Stopped');
  assert.equal(resolveMovementStatus({ movementStatus: 'Moving', ignition: false, speed: 0 }), 'Moving');
  assert.equal(resolveMovementStatus({ ignition: true, speed: 2 }), 'Stopped');
  assert.equal(resolveMovementStatus({ ignition: true, speed: 2.1 }), 'Moving');
  assert.equal(resolveMovementStatus({ ignition: false, speed: 25 }), 'Stopped');
  assert.equal(resolveMovementStatus({ ignition: false, speed: 1 }), 'Stopped');
});

test('normalizers retain raw provider fields and leave missing timestamps missing', () => {
  const wheelsEye = normalizeWheelseyeItem({
    vehicleNumber: 'test-1',
    speed: '0',
    ignition: 'false',
    latitude: '28.5',
    longitude: '77.2',
    lastUpdatedAt: 0,
  });
  assert.equal(wheelsEye.speed, 0);
  assert.equal(wheelsEye.ignition, false);
  assert.equal(wheelsEye.timestamp, null);
  assert.equal(wheelsEye.rawTelemetry.ignition, 'false');
  assert.equal(normalizeWheelseyeItem({ vehicleNumber: 'missing-fields' }).speed, null);
  assert.equal(normalizeWheelseyeItem({ vehicleNumber: 'missing-fields' }).ignition, null);

  const fleetx = normalizeFleetxItem({
    vehicleNumber: 'test-2',
    speed: '42',
    otherAttributes: { ignition: '0' },
  });
  assert.equal(fleetx.speed, 42);
  assert.equal(fleetx.ignition, false);
  assert.equal(fleetx.timestamp, null);
  assert.equal(normalizeFleetxItem({
    vehicleNumber: 'test-3',
    status: 'Ignition Off',
  }).ignition, false);
  assert.equal(normalizeFleetxItem({
    vehicleNumber: 'test-4',
    status: '0',
  }).ignition, null);
  const stoppedFleetx = normalizeFleetxItem({
    vehicleNumber: 'test-5',
    speed: '40',
    status: 'Stopped',
  });
  assert.equal(stoppedFleetx.ignition, null);
  assert.equal(stoppedFleetx.movementStatus, 'Stopped');
  assert.equal(parseTelematicsTimestamp({}), null);
});

test('uses vendor timestamps and saved plant centers and radii', () => {
  assert.equal(
    calculateStayDuration('2026-01-01T10:00:00Z', '2026-01-01T11:15:00Z'),
    '01:15'
  );
  assert.equal(calculateStayDuration('2026-01-01T10:00:00Z', null), 'N/A');
  const savedPlant = {
    plantName: 'DASNA Plant',
    latitude: 28.5,
    longitude: 77.2,
    radiusMeters: 900,
  };
  assert.equal(getPlantRadiusMeters(savedPlant), 900);
  assert.equal(getPlantRadiusMeters({ plantName: 'Salt Plant', radiusMeter: 275 }), 275);
  assert.equal(getPlantRadiusMeters({ plantName: 'Tea Plant' }), null);
  assert.equal(getVehiclePlantStatus(
    { latitude: 28.5, longitude: 77.2, gpsTimestamp: '2026-01-01T10:00:00Z' },
    [savedPlant],
    { now: new Date('2026-01-01T10:10:00Z') }
  ).isInside, true);
  assert.equal(getVehiclePlantStatus(
    { latitude: 0, longitude: 0, gpsTimestamp: '2026-01-01T10:00:00Z' },
    [savedPlant],
    { now: new Date('2026-01-01T10:10:00Z') }
  ).isInside, false);
});

test('rejects 0,0 plant centers before they can be saved', async () => {
  const plant = new Plant({
    plantName: 'Test Plant',
    location: 'Test address',
    radiusMeters: 100,
    latitude: 0,
    longitude: 0,
  });
  await assert.rejects(plant.validate(), (error) => (
    error.errors.latitude.message === 'Plant coordinates cannot be 0,0.'
  ));
});
