const test = require('node:test');
const assert = require('node:assert/strict');
const { getSyncOutcome } = require('../services/gpsSyncEngine');

test('sync outcome distinguishes provider failure, partial saves, and unchanged records', () => {
  assert.deepEqual(
    getSyncOutcome({ fetchFailed: true, failedCount: 0, savedCount: 0, unchangedCount: 0 }),
    { status: 'FAILED', success: false }
  );
  assert.deepEqual(
    getSyncOutcome({ fetchFailed: false, failedCount: 4, savedCount: 0, unchangedCount: 0 }),
    { status: 'FAILED', success: false }
  );
  assert.deepEqual(
    getSyncOutcome({ fetchFailed: false, failedCount: 2, savedCount: 3, unchangedCount: 0 }),
    { status: 'PARTIAL', success: true }
  );
  assert.deepEqual(
    getSyncOutcome({ fetchFailed: false, failedCount: 0, savedCount: 0, unchangedCount: 4 }),
    { status: 'SUCCESS', success: true }
  );
});
