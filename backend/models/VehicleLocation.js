const mongoose = require('mongoose');

const vehicleLocationSchema = new mongoose.Schema(
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
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    gpsDateTime: {
      type: Date,
      required: true,
      index: true,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    syncId: {
      type: String,
      default: '',
    },
    syncType: {
      type: String,
      enum: ['AUTO', 'MANUAL'],
      default: undefined,
    },
    providerTransitionTimestamp: {
      type: Date,
      default: null,
    },
    speed: {
      type: Number,
      default: null,
    },
    speedRaw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    ignition: {
      type: Boolean,
      default: null,
    },
    ignitionRaw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    movementStatus: {
      type: String,
      enum: ['Moving', 'Stopped', null],
      default: null,
    },
    rawTelemetry: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    address: {
      type: String,
      default: '',
    },
    geofence_status: {
      type: String,
      enum: ['INSIDE', 'OUTSIDE', 'UNKNOWN'],
      default: 'OUTSIDE',
    },
    plant_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      default: null,
      index: true,
    },
    plantName: {
      type: String,
      default: '',
    },
    plantRadiusMeters: {
      type: Number,
      default: null,
    },
    configuredPlantRadii: {
      type: [{
        plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', default: null },
        plantName: { type: String, required: true },
        radiusMeters: { type: Number, required: true },
      }],
      default: [],
    },
    sync_source: {
      type: String,
      enum: ['AUTO', 'MANUAL', 'STARTUP', 'RETRY', 'GPS-AUTO'],
      default: 'GPS-AUTO',
    },
    rawEventId: {
      type: String,
      default: '',
    },
    source: {
      type: String,
      default: 'WheelsEye GPS',
    },
    provider: {
      type: String,
      default: 'WheelsEye GPS',
      index: true,
    },
    archived: {
      type: Boolean,
      default: false,
      index: true,
    },
    vehicleNumberNormalized: {
      type: String,
      default: '',
      index: true,
    },
  },
  {
    collection: 'vehicleLocations',
    timestamps: true,
  }
);

// Indexes for fast querying & history lookups
vehicleLocationSchema.index({ vehicleId: 1, gpsDateTime: -1 });
vehicleLocationSchema.index({ vehicleNumber: 1, gpsDateTime: -1 });
vehicleLocationSchema.index({ vehicleId: 1, gpsDateTime: 1 });
vehicleLocationSchema.index({ vehicleNumberNormalized: 1, provider: 1, gpsDateTime: 1 });

module.exports = mongoose.model('VehicleLocation', vehicleLocationSchema);
