const test = require('node:test');
const assert = require('node:assert/strict');
const ZoneSession = require('../models/ZoneSession');
const {
  applyFixToOpenSession,
  getZoneId,
  seedSessionFromCurrentStatus,
} = require('../services/zoneSessionService');
const {
  calculateDailySessionHours,
  formatMinutes,
  istDayRange,
} = require('../services/gpsTimelineService');

function fix(zoneId, gpsTimestamp, plantId = null, syncTime = gpsTimestamp) {
  return {
    vehicleId: 'vehicle-1',
    vehicleNumber: 'UP14AA1001',
    zoneId,
    plantId,
    gpsTimestamp: new Date(gpsTimestamp),
    syncTime: new Date(syncTime),
    provider: 'WheelsEye GPS',
    syncType: 'AUTO',
  };
}

test('zone stays retain entry fix time and update from provider GPS timestamps', () => {
  const first = applyFixToOpenSession(
    null,
    fix('SALT', '2026-11-16T10:00:00Z', 'salt-id', '2026-11-16T10:05:00Z')
  );
  const next = applyFixToOpenSession(
    first.session,
    fix('SALT', '2026-11-16T10:30:00Z', 'salt-id', '2026-11-16T10:35:00Z')
  );

  assert.equal(first.session.enteredAt.toISOString(), '2026-11-16T10:00:00.000Z');
  assert.equal(first.session.detectedAt.toISOString(), '2026-11-16T10:05:00.000Z');
  assert.equal(next.session.enteredAt.toISOString(), first.session.enteredAt.toISOString());
  assert.equal(next.session.detectedAt.toISOString(), first.session.detectedAt.toISOString());
  assert.equal(next.session.lastSeenAt.toISOString(), '2026-11-16T10:30:00.000Z');
  assert.equal(next.action, 'update');
});

test('leaving Salt closes it at the first Outside fix, then opens Tea at its GPS fix', () => {
  const salt = applyFixToOpenSession(null, fix('SALT', '2026-11-16T10:00:00Z', 'salt-id', '2026-11-16T10:02:00Z'));
  const outside = applyFixToOpenSession(salt.session, fix('OUTSIDE', '2026-11-16T10:45:00Z', null, '2026-11-16T11:00:00Z'));
  const tea = applyFixToOpenSession(outside.session, fix('TEA', '2026-11-16T11:10:00Z', 'tea-id', '2026-11-16T11:15:00Z'));

  assert.equal(outside.closeAt.toISOString(), '2026-11-16T10:45:00.000Z');
  assert.equal(outside.exitDetectedAt.toISOString(), '2026-11-16T11:00:00.000Z');
  assert.equal(outside.session.zoneId, 'OUTSIDE');
  assert.equal(tea.closeAt.toISOString(), '2026-11-16T11:10:00.000Z');
  assert.equal(tea.exitDetectedAt.toISOString(), '2026-11-16T11:15:00.000Z');
  assert.equal(tea.session.zoneId, 'TEA');
  assert.equal(tea.session.enteredAt.toISOString(), '2026-11-16T11:10:00.000Z');
  assert.equal(tea.session.detectedAt.toISOString(), '2026-11-16T11:15:00.000Z');
});

test('duplicate or out-of-order sync fixes cannot reset or reopen a session', () => {
  const current = applyFixToOpenSession(null, fix('SALT', '2026-11-16T10:00:00Z'));
  const duplicate = applyFixToOpenSession(current.session, fix('OUTSIDE', '2026-11-16T09:59:00Z'));
  assert.equal(duplicate.action, 'unchanged');
  assert.equal(duplicate.session.zoneId, 'SALT');
});

test('zone entry time cannot be later than the real GPS fix timestamp', () => {
  const result = applyFixToOpenSession(null, {
    ...fix('SALT', '2026-11-16T10:00:00Z'),
    enteredAt: new Date('2026-11-16T10:30:00Z'),
  });
  assert.equal(result.session.enteredAt.toISOString(), '2026-11-16T10:00:00.000Z');
});

test('preserves a provider transition timestamp separately from sync detection time', () => {
  const result = applyFixToOpenSession(null, {
    ...fix('SALT', '2026-11-16T10:00:00Z', 'salt-id', '2026-11-16T10:05:00Z'),
    providerTransitionTimestamp: new Date('2026-11-16T09:58:00Z'),
  });
  assert.equal(result.session.enteredAt.toISOString(), '2026-11-16T10:00:00.000Z');
  assert.equal(result.session.detectedAt.toISOString(), '2026-11-16T10:05:00.000Z');
  assert.equal(result.session.providerTransitionTimestamp.toISOString(), '2026-11-16T09:58:00.000Z');
});

test('confirmed geofence transitions retain the first candidate fix time and current last-seen time', () => {
  const outside = applyFixToOpenSession(null, fix('OUTSIDE', '2026-11-16T10:00:00Z'));
  const transition = applyFixToOpenSession(outside.session, {
    ...fix('SALT', '2026-11-16T10:20:00Z', 'salt-id', '2026-11-16T10:25:00Z'),
    transitionGpsTimestamp: new Date('2026-11-16T10:10:00Z'),
  });

  assert.equal(transition.closeAt.toISOString(), '2026-11-16T10:10:00.000Z');
  assert.equal(transition.session.enteredAt.toISOString(), '2026-11-16T10:10:00.000Z');
  assert.equal(transition.session.lastSeenAt.toISOString(), '2026-11-16T10:20:00.000Z');
});

test('reconstructs a missing session from persisted status without resetting its entry time', () => {
  const priorStatus = {
    vehicleId: 'vehicle-1',
    vehicleNumber: 'UP14AA1001',
    provider: 'WheelsEye GPS',
    status: 'Inside',
    current_plant: 'Salt Plant',
    currentPlantId: 'salt-id',
    latest_gps_timestamp: new Date('2026-11-16T10:30:00Z'),
    lastEntryDateTime: new Date('2026-11-16T10:00:00Z'),
    lastEntryGpsTimestamp: new Date('2026-11-16T10:00:00Z'),
    lastEntryDetectedAt: new Date('2026-11-16T10:05:00Z'),
    lastSyncType: 'AUTO',
  };
  const seed = seedSessionFromCurrentStatus(
    fix('SALT', '2026-11-16T10:45:00Z', 'salt-id', '2026-11-16T10:50:00Z'),
    priorStatus
  );
  const next = applyFixToOpenSession(
    seed,
    fix('SALT', '2026-11-16T10:45:00Z', 'salt-id', '2026-11-16T10:50:00Z')
  );

  assert.equal(next.action, 'update');
  assert.equal(next.session.enteredAt.toISOString(), '2026-11-16T10:00:00.000Z');
  assert.equal(next.session.detectedAt.toISOString(), '2026-11-16T10:05:00.000Z');
});

test('plant names map to configured session zones and open sessions are provider-scoped', () => {
  assert.equal(getZoneId('DASNA Plant'), 'DASNA');
  assert.equal(getZoneId('Salt Plant'), 'SALT');
  assert.equal(getZoneId('Tea Plant'), 'TEA');
  assert.equal(getZoneId(''), 'OUTSIDE');
  assert.equal(getZoneId('North Yard Plant', 'north-yard-id'), 'PLANT_north-yard-id');
  const openIndex = ZoneSession.schema.indexes().find(([, options]) => options.name === 'one_open_zone_session_per_vehicle_provider');
  assert.deepEqual(openIndex[0], { vehicleNumberNormalized: 1, provider: 1 });
  assert.equal(openIndex[1].unique, true);
  assert.deepEqual(openIndex[1].partialFilterExpression, { exitedAt: null, archived: false });
});

test('session report splits midnight crossings and totals a full IST day with explicit gaps', () => {
  const { start, end } = istDayRange('2026-11-16');
  const samples = [
    { gpsTimestamp: new Date(start.getTime() - 10 * 60000), syncTime: new Date(start.getTime()), latitude: 28.5, longitude: 77.2 },
    { gpsTimestamp: new Date(start.getTime() + 20 * 60000), syncTime: new Date(start.getTime()), latitude: 28.5, longitude: 77.2 },
    { gpsTimestamp: new Date(start.getTime() + 40 * 60000), syncTime: new Date(start.getTime()), latitude: 28.9, longitude: 77.9 },
  ];
  const sessions = [
    {
      zoneId: 'SALT',
      enteredAt: new Date(start.getTime() - 30 * 60000),
      exitedAt: new Date(start.getTime() + 30 * 60000),
    },
    {
      zoneId: 'OUTSIDE',
      enteredAt: new Date(start.getTime() + 30 * 60000),
      exitedAt: null,
    },
  ];
  const report = calculateDailySessionHours(samples, sessions, start, end);
  const total = Object.values(report.minutes).reduce((sum, minutes) => sum + minutes, 0);

  assert.equal(total, 1440);
  assert.equal(formatMinutes(total), '24:00');
  assert.equal(report.minutes['Salt Plant'], 30);
  assert.ok(report.minutes['No GPS Data'] > 0);
  assert.ok(report.segments.some((segment) => segment.status === 'Outside'));
});
