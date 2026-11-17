const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getProviderVehicleRegistryRecords,
  filterTelemetryForActiveVehicles,
} = require('../services/gpsSyncService');
const {
  getAssignedGpsProvider,
  getGpsConnectionStatus,
} = require('../utils/gpsProvider');

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

test('assigned GPS provider controls which telemetry can update a vehicle', () => {
  const vehiclesByNumber = new Map([
    ['UP14AA1001', {
      status: 'Active',
      gpsProvider: 'fleetx',
      gpsProviders: ['WheelsEye GPS'],
    }],
    ['UP14BB2002', {
      status: 'Active',
      gpsProviders: ['FleetX'],
    }],
    ['UP14CC3003', {
      status: 'Active',
      gpsProvider: 'wheelseye',
      gpsProviders: ['FleetX'],
    }],
  ]);
  const telemetry = [
    { vehicleNumber: 'UP14AA1001' },
    { vehicleNumber: 'UP14BB2002' },
    { vehicleNumber: 'UP14CC3003' },
    { vehicleNumber: 'UP14DD4004' },
  ];

  assert.equal(getAssignedGpsProvider(vehiclesByNumber.get('UP14AA1001')), 'fleetx');
  assert.deepEqual(
    filterTelemetryForActiveVehicles(telemetry, vehiclesByNumber, 'FleetX')
      .map((item) => item.vehicleNumber),
    ['UP14AA1001', 'UP14BB2002']
  );
  assert.deepEqual(
    filterTelemetryForActiveVehicles(telemetry, vehiclesByNumber, 'WheelsEye GPS')
      .map((item) => item.vehicleNumber),
    ['UP14CC3003']
  );
});

test('GPS health never treats an unchecked or stale Connected setting as live', () => {
  const originalUrl = process.env.WHEELSEYE_API_URL;
  delete process.env.WHEELSEYE_API_URL;
  try {
    const now = Date.parse('2026-11-17T12:00:00Z');
    assert.equal(
      getGpsConnectionStatus({ connectionStatus: 'Connected' }, 'WheelsEye GPS', now),
      'Configuration Missing'
    );
    assert.equal(
      getGpsConnectionStatus({
        connectionStatus: 'Connected',
        lastConnectionCheckAt: new Date(now - 61 * 60 * 1000),
      }, 'WheelsEye GPS', now),
      'Disconnected'
    );
    assert.equal(
      getGpsConnectionStatus({
        connectionStatus: 'Connected',
        lastConnectionCheckAt: new Date(now - 5 * 60 * 1000),
      }, 'WheelsEye GPS', now),
      'Connected'
    );
  } finally {
    if (originalUrl === undefined) delete process.env.WHEELSEYE_API_URL;
    else process.env.WHEELSEYE_API_URL = originalUrl;
  }
});
