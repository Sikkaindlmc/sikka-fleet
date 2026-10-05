const mongoose = require('mongoose');

const driverLocationSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      required: true,
      index: true,
    },
    driverName: {
      type: String,
      required: true,
    },
    dlNumber: {
      type: String,
      required: true,
      index: true,
    },
    mobileNumber: {
      type: String,
      required: true,
    },
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    accuracy: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      default: 'Location Deducted',
    },
    currentStatus: {
      type: String,
      enum: ['Inside', 'Outside'],
      default: 'Outside',
    },
    plantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      default: null,
    },
    plantName: {
      type: String,
      default: null,
    },
    distanceToPlantMeters: {
      type: Number,
      default: null,
    },
    capturedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    collection: 'driverLocations',
    timestamps: true,
  }
);

driverLocationSchema.index({ driverId: 1, capturedAt: -1 });

module.exports = mongoose.model('DriverLocation', driverLocationSchema);
