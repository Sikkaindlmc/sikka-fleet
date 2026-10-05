const mongoose = require('mongoose');

const driverPlantRecordSchema = new mongoose.Schema(
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
    status: {
      type: String,
      enum: ['Inside', 'Completed'],
      default: 'Inside',
      index: true,
    },
    inTime: {
      type: Date,
      default: Date.now,
      required: true,
      index: true,
    },
    inLatitude: {
      type: Number,
      required: true,
    },
    inLongitude: {
      type: Number,
      required: true,
    },
    inDistanceMeters: {
      type: Number,
      default: null,
    },
    outTime: {
      type: Date,
      default: null,
    },
    outLatitude: {
      type: Number,
      default: null,
    },
    outLongitude: {
      type: Number,
      default: null,
    },
    outDistanceMeters: {
      type: Number,
      default: null,
    },
    lastCheckedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: 'driverPlantRecords',
    timestamps: true,
  }
);

driverPlantRecordSchema.index({ driverId: 1, status: 1 });
driverPlantRecordSchema.index({ driverId: 1, inTime: -1 });

module.exports = mongoose.model('DriverPlantRecord', driverPlantRecordSchema);
