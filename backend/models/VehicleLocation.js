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
      default: Date.now,
      index: true,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    speed: {
      type: Number,
      default: 0,
    },
    ignition: {
      type: Boolean,
      default: false,
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
      enum: ['AUTO', 'MANUAL', 'STARTUP', 'RETRY'],
      default: 'AUTO',
    },
    rawEventId: {
      type: String,
      default: '',
    },
    source: {
      type: String,
      default: 'WheelsEye GPS',
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

module.exports = mongoose.model('VehicleLocation', vehicleLocationSchema);
