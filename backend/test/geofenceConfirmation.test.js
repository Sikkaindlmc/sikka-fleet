const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateGeofenceConfirmation } = require('../services/geofenceConfirmation');

const firstFixTime = new Date('2026-11-17T10:00:00Z');

function fix(overrides = {}) {
  return {
    gpsTimestamp: firstFixTime,
    geofence_status: 'OUTSIDE',
    candidateGeofenceStatus: 'OUTSIDE',
    candidatePlantId: null,
    plantId: null,
    statusEligible: true,
    ...overrides,
  };
}

test('requires a second consecutive inside fix before confirming plant entry', () => {
  const pending = evaluateGeofenceConfirmation({
    currentStatus: { current_geofence: 'OUTSIDE' },
    previousFix: fix(),
    candidateStatus: 'INSIDE',
    candidatePlantId: 'plant-1',
    gpsTimestamp: '2026-11-17T10:10:00Z',
  });
  assert.equal(pending.status, 'OUTSIDE');
  assert.equal(pending.transition, null);

  const confirmed = evaluateGeofenceConfirmation({
    currentStatus: { current_geofence: 'OUTSIDE' },
    previousFix: fix({ candidateGeofenceStatus: 'INSIDE', candidatePlantId: 'plant-1' }),
    candidateStatus: 'INSIDE',
    candidatePlantId: 'plant-1',
    gpsTimestamp: '2026-11-17T10:10:00Z',
  });
  assert.equal(confirmed.status, 'INSIDE');
  assert.equal(confirmed.transition, 'ENTRY');
  assert.equal(confirmed.transitionGpsTimestamp.toISOString(), firstFixTime.toISOString());
});

test('confirms exits and plant changes only when the second fix matches the candidate', () => {
  const exited = evaluateGeofenceConfirmation({
    currentStatus: { current_geofence: 'INSIDE', currentPlantId: 'plant-1' },
    previousFix: fix({
      geofence_status: 'INSIDE',
      plantId: 'plant-1',
      candidateGeofenceStatus: 'OUTSIDE',
    }),
    candidateStatus: 'OUTSIDE',
    gpsTimestamp: '2026-11-17T10:10:00Z',
  });
  assert.equal(exited.transition, 'EXIT');

  const changedPlant = evaluateGeofenceConfirmation({
    currentStatus: { current_geofence: 'INSIDE', currentPlantId: 'plant-1' },
    previousFix: fix({
      geofence_status: 'INSIDE',
      plantId: 'plant-1',
      candidateGeofenceStatus: 'INSIDE',
      candidatePlantId: 'plant-2',
    }),
    candidateStatus: 'INSIDE',
    candidatePlantId: 'plant-2',
    gpsTimestamp: '2026-11-17T10:10:00Z',
  });
  assert.equal(changedPlant.transition, 'PLANT_CHANGE');
  assert.equal(changedPlant.plantId, 'plant-2');
});

test('does not confirm stale, out-of-order, or widely separated fixes', () => {
  for (const previousFix of [
    fix({ statusEligible: false, candidateGeofenceStatus: 'INSIDE', candidatePlantId: 'plant-1' }),
    fix({ gpsTimestamp: new Date('2026-11-17T10:10:00Z'), candidateGeofenceStatus: 'INSIDE', candidatePlantId: 'plant-1' }),
    fix({ gpsTimestamp: new Date('2026-11-17T07:00:00Z'), candidateGeofenceStatus: 'INSIDE', candidatePlantId: 'plant-1' }),
  ]) {
    const result = evaluateGeofenceConfirmation({
      currentStatus: { current_geofence: 'OUTSIDE' },
      previousFix,
      candidateStatus: 'INSIDE',
      candidatePlantId: 'plant-1',
      gpsTimestamp: '2026-11-17T10:10:00Z',
    });
    assert.equal(result.status, 'OUTSIDE');
    assert.equal(result.transition, null);
  }
});
