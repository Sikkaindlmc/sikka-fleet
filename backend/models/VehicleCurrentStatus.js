const mongoose = require('mongoose');

const vehicleCurrentStatusSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      unique: true,
      index: true,
    },
    vehicleNumber: {
      type: String,
      default: '',
      index: true,
    },
    currentPlantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      default: null,
      index: true,
    },
    current_plant: {
      type: String,
      default: null,
    },
    current_geofence: {
      type: String,
      enum: ['INSIDE', 'OUTSIDE', 'UNKNOWN'],
      default: 'OUTSIDE',
      index: true,
    },
    status: {
      type: String,
      enum: ['Inside', 'Outside'],
      default: 'Outside',
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
    distanceMeter: {
      type: Number,
      default: null,
    },
    latest_gps_timestamp: {
      type: Date,
      default: null,
      index: true,
    },
    last_successful_sync_at: {
      type: Date,
      default: null,
    },
    gps_status: {
      type: String,
      enum: ['LIVE', 'RECENT', 'GPS STALE', 'GPS SYNC FAILED', 'GPS DATA UNAVAILABLE'],
      default: 'LIVE',
      index: true,
    },
    last_sync_source: {
      type: String,
      enum: ['AUTO', 'MANUAL', 'STARTUP', 'RETRY'],
      default: 'AUTO',
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
    lastEntryDateTime: {
      type: Date,
      default: null,
    },
    lastExitPlantName: {
      type: String,
      default: null,
    },
    lastExitDateTime: {
      type: Date,
      default: null,
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    plans: [
      {
        planText: { type: String, required: true },
        authorName: { type: String, required: true },
        authorUsername: { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

vehicleCurrentStatusSchema.virtual('latest_latitude').get(function () {
  return this.latitude;
});

vehicleCurrentStatusSchema.virtual('latest_longitude').get(function () {
  return this.longitude;
});

module.exports = mongoose.model('VehicleCurrentStatus', vehicleCurrentStatusSchema);
