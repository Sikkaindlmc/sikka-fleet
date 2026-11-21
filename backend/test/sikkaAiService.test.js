const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FUTURE_DATA_MESSAGE,
  NOT_REGISTERED_MESSAGE,
  UNAVAILABLE_MESSAGE,
  extractDateRange,
  extractVehicleToken,
  formatToolAnswer,
  getSuggestions,
  hasFuzzyKeyword,
  hashQuery,
  parseDateBoundary,
  recognizeQuestion,
  validatePastRange,
} = require('../services/sikkaAiService');

const now = new Date('2026-11-17T12:00:00Z');

test('parses date-only and timezone-free AI dates as India Standard Time', () => {
  assert.equal(
    parseDateBoundary('2026-11-17').toISOString(),
    '2026-11-16T18:30:00.000Z'
  );
  assert.equal(
    parseDateBoundary('2026-11-17T10:00:00').toISOString(),
    '2026-11-17T04:30:00.000Z'
  );
  assert.equal(parseDateBoundary('31/02/2026'), null);
});

test('rejects future dates and invalid history ranges', () => {
  assert.equal(validatePastRange({ from: '2026-11-18', to: '2026-11-19' }, now).error, FUTURE_DATA_MESSAGE);
  assert.equal(validatePastRange({ from: 'not-a-date', to: '2026-11-16' }, now).error, 'Use valid past dates or ISO 8601 date/time values.');
  assert.equal(validatePastRange({ from: '2026-11-17', to: '2026-11-16' }, now).error, 'The start of the requested date range must be before its end.');
  assert.equal(validatePastRange({ from: '2026-11-17', to: '2026-11-17' }, now).end.toISOString(), now.toISOString());
});

test('query audit hashes are deterministic and do not return the prompt', () => {
  assert.equal(hashQuery('Where is UP14AA1001?'), hashQuery('Where is UP14AA1001?'));
  assert.notEqual(hashQuery('Where is UP14AA1001?'), 'Where is UP14AA1001?');
});

test('local intent recognition routes GPS sync and historical lookup without an external model', () => {
  const syncIntent = recognizeQuestion('Sync GPS now');
  assert.equal(syncIntent.tool, 'sync_gps_now');
  assert.equal(syncIntent.args.provider, null);
  assert.equal(recognizeQuestion('Update FleetX').args.provider, 'FLEETX');
  assert.equal(recognizeQuestion('Update WheelsEye').args.provider, 'WHEELSEYE');
  const liveIntent = recognizeQuestion('Get the latest vehicle location for UP14AA1001');
  assert.equal(liveIntent.tool, 'get_vehicle_location');
  assert.equal(liveIntent.liveQuery, true);
  const historyIntent = recognizeQuestion('Where was vehicle UP14AA1001 yesterday at 10 AM?', now);
  assert.equal(historyIntent.tool, 'get_vehicle_history');
  assert.equal(historyIntent.args.vehicleNumber, 'UP14AA1001');
  assert.equal(historyIntent.args.targetTime, '2026-11-16T10:00:00');
  assert.equal(recognizeQuestion('Explain a topic unrelated to fleet data').tool, 'unsupported');
});

test('recognizes vehicle number formats, current and plant questions, and fuzzy spelling', () => {
  assert.equal(extractVehicleToken('where is UP 14 GT 0600'), 'UP14GT0600');
  assert.equal(extractVehicleToken('UP-14-GT-0600 kahan hai'), 'UP14GT0600');
  assert.equal(extractVehicleToken('show vehicle ending 0600'), '0600');
  assert.equal(recognizeQuestion('where is UP14GT0600').tool, 'get_vehicle_location');
  assert.equal(recognizeQuestion('UP14GT0600 abhi kahan hai').language, 'hinglish');
  const plantIntent = recognizeQuestion('vehicles in Salt Plant');
  assert.equal(plantIntent.tool, 'get_plant_availability');
  assert.equal(plantIntent.args.plantName, 'Salt Plant');
  assert.equal(plantIntent.args.includeVehicles, true);
  assert.equal(hasFuzzyKeyword('wher is UP14GT0600'), true);
  assert.equal(hasFuzzyKeyword('vehicles in Salt Plant'), false);
  assert.equal(recognizeQuestion('wher is UP14GT0600').tool, 'get_vehicle_location');
  assert.equal(getSuggestions('en', 'UP14GT0600').length, 4);
  const randomIntent = recognizeQuestion('Tell me a joke about the moon');
  assert.equal(randomIntent.tool, 'unsupported');
  assert.equal(randomIntent.suggestions.length, 4);
});

test('distinguishes ambiguous tomorrow/yesterday, resolves past Hindi, and refuses future dates', () => {
  assert.equal(recognizeQuestion('kal UP14GT0600 kahan hai', now).tool, 'clarify_date');
  const pastIntent = recognizeQuestion('kal UP14GT0600 kahan thi', now);
  assert.equal(pastIntent.tool, 'get_vehicle_history');
  assert.equal(recognizeQuestion('where is UP14GT0600 on 18-11-2026', now).tool, 'future_refusal');
  assert.equal(recognizeQuestion('where is UP14GT0600 tomorrow', now).tool, 'future_refusal');
  assert.equal(recognizeQuestion('where was UP14GT0600 yesterday', now).tool, 'get_vehicle_history');
  assert.equal(extractDateRange('where was UP14GT0600 yesterday', now).from, '2026-11-16');
});

test('required missing-data responses use the documented exact wording', () => {
  assert.equal(NOT_REGISTERED_MESSAGE, 'This vehicle is not registered in Sikka Fleet.');
  assert.equal(UNAVAILABLE_MESSAGE, 'Required information is not available in the Sikka Fleet database.');
});

test('location answers include the real source and an Asia/Kolkata GPS timestamp', () => {
  const answer = formatToolAnswer([{
    tool: 'get_vehicle_location',
    data: {
      vehicleNumber: 'UP14GT0600',
      dataSource: 'WheelsEye',
      gpsTimestamp: '2026-11-17T12:00:00.000Z',
      plantStatus: 'Inside',
      plantName: 'Salt Plant',
      latitude: 28.5,
      longitude: 77.2,
      speed: 0,
      ignition: false,
    },
  }]);
  assert.match(answer, /UP14GT0600/);
  assert.match(answer, /WheelsEye/);
  assert.match(answer, /17-11-2026 17:30/);
  assert.match(answer, /Salt Plant/);
});
