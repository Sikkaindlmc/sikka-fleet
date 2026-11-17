const mongoose = require('mongoose');

const plantEntrySchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      index: true,
    },
    vehicleNumber: {
      type: String,
      required: true,
      index: true,
    },
    plantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      required: true,
      index: true,
    },
    plantName: {
      type: String,
      required: true,
    },
    entryDateTime: {
      type: Date,
      default: Date.now,
      required: true,
      index: true,
    },
    detectedAt: {
      type: Date,
      default: null,
    },
    gpsTimestamp: {
      type: Date,
      default: null,
    },
    providerTransitionTimestamp: {
      type: Date,
      default: null,
    },
    syncTime: {
      type: Date,
      default: null,
    },
    syncId: {
      type: String,
      default: '',
    },
    syncType: {
      type: String,
      enum: ['AUTO', 'MANUAL'],
      default: 'AUTO',
    },
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    distanceMeter: {
      type: Number,
      default: null,
    },
    plantRadiusMeters: {
      type: Number,
      default: null,
    },
  },
  {
    collection: 'plantEntries',
    timestamps: true,
  }
);

// Indexes recommended in Section 15
plantEntrySchema.index({ plantId: 1, entryDateTime: -1 });
plantEntrySchema.index({ vehicleId: 1, entryDateTime: -1 });

module.exports = mongoose.model('PlantEntry', plantEntrySchema);
