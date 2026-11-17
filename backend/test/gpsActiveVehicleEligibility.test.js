const test = require('node:test');
const assert = require('node:assert/strict');
const { filterTelemetryForActiveVehicles } = require('../services/gpsSyncService');

test('GPS sync accepts telemetry only for registered active vehicles', () => {
  const vehiclesByNumber = new Map([
    ['UP14GT0100', { vehicleNumber: 'UP14GT0100', status: 'Active' }],
    ['UP14GT0200', { vehicleNumber: 'UP14GT0200', status: 'Inactive' }],
  ]);
  const telemetry = [
    { vehicleNumber: 'UP14GT0100' },
    { vehicleNumber: 'UP14GT0200' },
    { vehicleNumber: 'UP14GT0300' },
  ];

  assert.deepEqual(
    filterTelemetryForActiveVehicles(telemetry, vehiclesByNumber),
    [{ vehicleNumber: 'UP14GT0100' }]
  );
});
