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
    sync_source: {
      type: String,
      enum: ['AUTO', 'STARTUP', 'RETRY', 'GPS-AUTO'],
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
