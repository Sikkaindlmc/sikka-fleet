const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const { updateVehicleCurrentStatus } = require('../services/vehicleCurrentStatusService');

test('current status uses an ObjectId-keyed atomic upsert', async () => {
  const originalUpdateOne = VehicleCurrentStatus.updateOne;
  const vehicleId = new mongoose.Types.ObjectId();
  let captured;
  VehicleCurrentStatus.updateOne = async (...args) => {
    captured = args;
    return { upsertedCount: 1 };
  };

  try {
    await updateVehicleCurrentStatus(vehicleId.toString(), { gps_status: 'LIVE' });
    assert.deepEqual(captured[0], { vehicleId });
    assert.deepEqual(captured[1], { $set: { gps_status: 'LIVE' } });
    assert.equal(captured[2].upsert, true);
  } finally {
    VehicleCurrentStatus.updateOne = originalUpdateOne;
  }
});

test('current status retries a duplicate-key upsert race as an update', async () => {
  const originalUpdateOne = VehicleCurrentStatus.updateOne;
  const vehicleId = new mongoose.Types.ObjectId();
  const calls = [];
  VehicleCurrentStatus.updateOne = async (...args) => {
    calls.push(args);
    if (calls.length === 1) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    return { matchedCount: 1, modifiedCount: 1 };
  };

  try {
    const result = await updateVehicleCurrentStatus(vehicleId, { gps_status: 'LIVE' });
    assert.equal(result.matchedCount, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0][2].upsert, true);
    assert.equal(calls[1][2].upsert, true);
  } finally {
    VehicleCurrentStatus.updateOne = originalUpdateOne;
  }
});
