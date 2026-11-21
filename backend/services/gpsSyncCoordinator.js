const crypto = require('crypto');
const GpsSyncLock = require('../models/GpsSyncLock');

const LOCK_TTL_MS = 30 * 60 * 1000;
const MAX_WAIT_MS = 10 * 60 * 1000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getLockId(operation) {
  const normalized = String(operation || 'GPS_SYNC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `gps_sync_${normalized || 'GPS_SYNC'}`;
}

async function acquireLock(owner, operation) {
  const now = new Date();
  const lockId = getLockId(operation);
  try {
    const lock = await GpsSyncLock.findOneAndUpdate(
      {
        _id: lockId,
        $or: [
          { isLocked: false },
          { expiresAt: { $lt: now } },
          { isLocked: { $exists: false } },
        ],
      },
      {
        $set: {
          isLocked: true,
          lockedAt: now,
          lockedBy: owner,
          expiresAt: new Date(now.getTime() + LOCK_TTL_MS),
        },
      },
      { upsert: true, new: true }
    );
    return lock?.lockedBy === owner;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

async function runGpsSyncExclusive(run, operation = 'GPS sync') {
  const owner = `${operation}_${crypto.randomBytes(12).toString('hex')}`;
  const deadline = Date.now() + MAX_WAIT_MS;
  while (!(await acquireLock(owner, operation))) {
    if (Date.now() >= deadline) {
      throw new Error(`${operation} could not acquire the GPS sync lock within 10 minutes.`);
    }
    await wait(250);
  }

  try {
    return await run();
  } finally {
    try {
      await GpsSyncLock.updateOne(
        { _id: getLockId(operation), lockedBy: owner },
        { $set: { isLocked: false, expiresAt: new Date(0) } }
      );
    } catch (error) {
      console.error(`[GPS Sync Lock] Failed to release lock for ${operation}:`, error.message);
    }
  }
}

module.exports = { runGpsSyncExclusive };
