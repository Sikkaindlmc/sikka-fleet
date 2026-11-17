const test = require('node:test');
const assert = require('node:assert/strict');
const { getProviderVehicleRegistryRecords } = require('../services/gpsSyncService');

test('provider vehicle discovery normalizes and deduplicates vehicle numbers', () => {
  const records = getProviderVehicleRegistryRecords([
    { vehicleNumber: 'up14 gt-0600', driverName: '' },
    { vehicleNumber: 'UP14GT0600', driverName: 'Assigned Driver', deviceNumber: 'GPS-1' },
    { vehicleNumber: '  UP14TT8108  ' },
    { vehicleNumber: '  ' },
    { vehicleNumber: null },
  ]);

  assert.deepEqual(records, [
    {
      vehicleNumber: 'UP14GT0600',
      driverName: 'Assigned Driver',
      gpsDeviceId: 'GPS-1',
    },
    {
      vehicleNumber: 'UP14TT8108',
      driverName: '',
      gpsDeviceId: 'UP14TT8108',
    },
  ]);
});
