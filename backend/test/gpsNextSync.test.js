const test = require('node:test');
const assert = require('node:assert/strict');
const { getNextFixed30MinSlotIST } = require('../services/gpsSyncService');

test('calculates the next 30-minute slot at exact boundaries in IST', () => {
  assert.equal(
    getNextFixed30MinSlotIST(new Date('2026-11-21T09:00:00.000Z')).toISOString(),
    '2026-11-21T09:30:00.000Z'
  );
  assert.equal(
    getNextFixed30MinSlotIST(new Date('2026-11-21T09:30:00.000Z')).toISOString(),
    '2026-11-21T10:00:00.000Z'
  );
});

test('calculates the next slot across an IST day boundary', () => {
  assert.equal(
    getNextFixed30MinSlotIST(new Date('2026-11-21T18:15:00.000Z')).toISOString(),
    '2026-11-21T18:30:00.000Z'
  );
  assert.equal(
    getNextFixed30MinSlotIST(new Date('2026-11-21T18:30:00.000Z')).toISOString(),
    '2026-11-21T19:00:00.000Z'
  );
});
