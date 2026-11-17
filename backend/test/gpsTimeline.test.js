const test = require('node:test');
const assert = require('node:assert/strict');
const Vehicle = require('../models/Vehicle');
const GpsHistory = require('../models/GpsHistory');
const Plant = require('../models/Plant');
const PlantStay = require('../models/PlantStay');
const {
  buildTimeline,
  istDayRange,
  allocateStatusMinutes,
  formatMinutes,
  calculateDailyGpsHours,
} = require('../services/gpsTimelineService');
const { rebuildPlantStays } = require('../services/gpsDataService');

const plants = [
  { plantName: 'DASNA Plant', latitude: 28.5, longitude: 77.2, radiusMeters: 300 },
  { plantName: 'Salt Plant', latitude: 28.6, longitude: 77.3, radiusMeters: 500 },
  { plantName: 'Tea Plant', latitude: 28.7, longitude: 77.4, radiusMeters: 500 },
];

function point(gpsTimestamp, latitude, longitude) {
  return { gpsTimestamp: new Date(gpsTimestamp), latitude, longitude, syncTime: new Date(gpsTimestamp) };
}

test('rebuilding plant stays loads the chronological GPS sample utility', async () => {
  const originals = {
    findVehicle: Vehicle.findById,
    findHistory: GpsHistory.find,
    findPlants: Plant.find,
    deleteStays: PlantStay.deleteMany,
  };
  Vehicle.findById = async () => ({ vehicleNumber: 'UP14AA1001' });
  GpsHistory.find = () => ({ sort: async () => [] });
  Plant.find = async () => [];
  PlantStay.deleteMany = async () => ({ deletedCount: 0 });
  try {
    await assert.doesNotReject(rebuildPlantStays('test-vehicle-id'));
  } finally {
    Vehicle.findById = originals.findVehicle;
    GpsHistory.find = originals.findHistory;
    Plant.find = originals.findPlants;
    PlantStay.deleteMany = originals.deleteStays;
  }
});

test('completed vehicle-days always allocate exactly 24 hours, including long GPS outages', () => {
  const { start, end } = istDayRange('2026-11-11');
  const samples = [
    point('2026-11-10T18:30:00Z', 28.9, 77.9),
    point('2026-11-11T00:00:00Z', 28.6, 77.3),
    point('2026-11-11T07:00:00Z', 28.9, 77.9),
  ];
  const segments = buildTimeline(samples, plants, start, end);
  const minutes = allocateStatusMinutes(segments, 1440);

  assert.equal(Object.values(minutes).reduce((sum, value) => sum + value, 0), 1440);
  assert.equal(formatMinutes(Object.values(minutes).reduce((sum, value) => sum + value, 0)), '24:00');
  assert.ok(minutes['No GPS Data'] > 0);
  assert.ok(segments.some((segment) => segment.status === 'No GPS Data'));
});

test('all generated vehicle-day hour totals equal 24:00 for a completed IST date', () => {
  const { start, end } = istDayRange('2026-11-11');
  const vehicleNumbers = Array.from({ length: 21 }, (_, index) => `UP14GT${String(index).padStart(4, '0')}`);
  for (const vehicleNumber of vehicleNumbers) {
    const reportDay = calculateDailyGpsHours([], plants, start, end);
    const allocatedTotal = Object.values(reportDay.minutes).reduce((sum, value) => sum + value, 0);
    assert.equal(formatMinutes(allocatedTotal), '24:00', `${vehicleNumber} on 2026-11-11`);
  }
});

test('cross-midnight segments are clipped at IST midnight and partial days total elapsed time', () => {
  const firstDay = istDayRange('2026-11-10');
  const nextDay = istDayRange('2026-11-11');
  const samples = [
    point('2026-11-10T18:00:00Z', 28.6, 77.3),
    point('2026-11-10T19:00:00Z', 28.6, 77.3),
  ];
  const firstSegments = buildTimeline(samples, plants, firstDay.start, firstDay.end);
  const nextSegments = buildTimeline(samples, plants, nextDay.start, new Date(nextDay.start.getTime() + 60 * 60 * 1000));
  assert.ok(firstSegments.every((segment) => segment.start >= firstDay.start && segment.end <= firstDay.end));
  assert.ok(nextSegments.every((segment) => segment.start >= nextDay.start && segment.end <= nextDay.start.getTime() + 60 * 60 * 1000));
  const partialMinutes = allocateStatusMinutes(nextSegments, 60);
  assert.equal(Object.values(partialMinutes).reduce((sum, value) => sum + value, 0), 60);
});

test('a vehicle-day without GPS history is entirely No GPS Data', () => {
  const { start, end } = istDayRange('2026-11-11');
  const minutes = allocateStatusMinutes(buildTimeline([], plants, start, end), 1440);
  assert.deepEqual(minutes, {
    DASNA: 0,
    'Salt Plant': 0,
    'Tea Plant': 0,
    Outside: 0,
    'No GPS Data': 1440,
  });
});
