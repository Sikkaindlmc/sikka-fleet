const mongoose = require('mongoose');

const zoneSessionSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      index: true,
    },
    vehicleNumber: { type: String, required: true, trim: true },
    vehicleNumberNormalized: { type: String, required: true, trim: true, index: true },
    zoneId: { type: String, required: true },
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', default: null },
    enteredAt: { type: Date, required: true },
    entryGpsTimestamp: { type: Date, default: null },
    detectedAt: { type: Date, default: null },
    providerTransitionTimestamp: { type: Date, default: null },
    lastSeenAt: { type: Date, required: true },
    exitedAt: { type: Date, default: null },
    exitGpsTimestamp: { type: Date, default: null },
    exitDetectedAt: { type: Date, default: null },
    providerExitTransitionTimestamp: { type: Date, default: null },
    syncId: { type: String, default: '' },
    syncType: { type: String, enum: ['AUTO', 'MANUAL'], default: undefined },
    provider: { type: String, required: true },
    archived: { type: Boolean, default: false, index: true },
  },
  { collection: 'zone_sessions', timestamps: true }
);

zoneSessionSchema.index(
  { vehicleNumberNormalized: 1, provider: 1 },
  {
    unique: true,
    name: 'one_open_zone_session_per_vehicle_provider',
    partialFilterExpression: { exitedAt: null, archived: false },
  }
);
zoneSessionSchema.index({ vehicleId: 1, enteredAt: 1 });

module.exports = mongoose.model('ZoneSession', zoneSessionSchema);
