const mongoose = require('mongoose');

const gpsSyncLockSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: 'gps_sync_lock',
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    lockedAt: {
      type: Date,
      default: null,
    },
    lockedBy: {
      type: String,
      default: '',
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    collection: 'gps_sync_locks',
    timestamps: true,
  }
);

module.exports = mongoose.model('GpsSyncLock', gpsSyncLockSchema);
