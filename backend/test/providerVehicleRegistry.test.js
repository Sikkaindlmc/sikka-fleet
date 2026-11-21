const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getProviderVehicleRegistryRecords,
  filterTelemetryForActiveVehicles,
} = require('../services/gpsSyncService');
const {
  getAssignedGpsProvider,
  getGpsConnectionStatus,
  isVehicleAssignedToProvider,
} = require('../utils/gpsProvider');
const GpsSetting = require('../models/GpsSetting');

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

test('WheelsEye GPS configuration defaults to active', () => {
  const setting = new GpsSetting();
  assert.equal(setting.provider, 'WheelsEye GPS');
  assert.equal(setting.status, 'Active');
});

test('provider assignment keeps the two GPS integrations independent', () => {
  assert.equal(isVehicleAssignedToProvider({ gps_provider: 'FLEETX' }, 'WHEELSEYE'), false);
  assert.equal(isVehicleAssignedToProvider({ gps_provider: 'FLEETX' }, 'FLEETX'), true);
  assert.equal(isVehicleAssignedToProvider({ gps_provider: 'BOTH' }, 'WHEELSEYE'), true);
  assert.equal(isVehicleAssignedToProvider({ gps_provider: 'BOTH' }, 'FLEETX'), true);
  assert.equal(isVehicleAssignedToProvider({
    gps_provider: 'FLEETX',
    gpsProvider: 'wheelseye',
    gpsProviders: ['WheelsEye GPS'],
  }, 'WHEELSEYE'), false);
  assert.equal(isVehicleAssignedToProvider({
    gps_provider: 'WHEELSEYE',
    gpsProvider: 'fleetx',
    $isDefault: (field) => field === 'gps_provider',
  }, 'FLEETX'), true);
});

test('WheelsEye sync updates registered active vehicles and excludes inactive or unregistered vehicles', () => {
  const vehiclesByNumber = new Map([
    ['UP14AA1001', { status: 'Active' }],
    ['UP14BB2002', { status: 'Inactive' }],
    ['UP14CC3003', { status: 'Active' }],
  ]);
  const telemetry = [
    { vehicleNumber: 'UP14AA1001' },
    { vehicleNumber: 'UP14BB2002' },
    { vehicleNumber: 'UP14CC3003' },
    { vehicleNumber: 'UP14DD4004' },
  ];

  assert.equal(getAssignedGpsProvider(), 'wheelseye');
  assert.deepEqual(
    filterTelemetryForActiveVehicles(telemetry, vehiclesByNumber)
      .map((item) => item.vehicleNumber),
    ['UP14AA1001', 'UP14CC3003']
  );
});

test('GPS health never treats unchecked or stale settings as live', () => {
  const originalUrl = process.env.WHEELSEYE_API_URL;
  delete process.env.WHEELSEYE_API_URL;
  try {
    const now = Date.parse('2026-11-17T12:00:00Z');
    assert.equal(
      getGpsConnectionStatus({ connectionStatus: 'Connected' }, 'WheelsEye GPS', now),
      'Disconnected'
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
