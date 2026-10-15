const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema(
  {
    driverName: {
      type: String,
      required: [true, 'Driver Name is required'],
      trim: true,
    },
    dlNumber: {
      type: String,
      required: [true, 'DL Number is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    dob: {
      type: Date,
      required: [true, 'Date of Birth is required'],
    },
    mobileNumber: {
      type: String,
      required: [true, 'Mobile Number is required'],
      unique: true,
      trim: true,
    },
    countryCode: {
      type: String,
      default: '+91',
    },
    photo: {
      type: String,
      default: null,
    },
    radiusFromVehicleMeter: {
      type: Number,
      required: [true, 'Radius from Vehicle Meter is required'],
      min: [10, 'Radius from Vehicle Meter must be at least 10 meters'],
      max: [300, 'Radius from Vehicle Meter cannot exceed 300 meters'],
      validate: {
        validator: Number.isInteger,
        message: 'Radius from Vehicle Meter must be a whole number between 10 and 300 meters',
      },
      default: 100,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
    lastLoginLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      capturedAt: { type: Date, default: null },
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    // Real-time Driver Geofencing & Location Tracking
    currentStatus: {
      type: String,
      enum: ['Inside', 'Outside'],
      default: 'Outside',
    },
    currentPlantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      default: null,
    },
    currentPlantName: {
      type: String,
      default: null,
    },
    currentPlantInTime: {
      type: Date,
      default: null,
    },
    lastPlantOutTime: {
      type: Date,
      default: null,
    },
    lastLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      capturedAt: { type: Date, default: null },
    },
    lastLocationUpdateAt: {
      type: Date,
      default: null,
    },
    locationDeductionStatus: {
      type: String,
      enum: ['Location Deducted', 'Location Not Deducted'],
      default: 'Location Not Deducted',
    },
    lastLocationAttemptAt: {
      type: Date,
      default: null,
    },
    lastLocationError: {
      type: String,
      default: null,
    },
  },
  {
    collection: 'drivers',
    timestamps: true,
  }
);

// Secondary indexes for search performance
driverSchema.index({ status: 1 });

module.exports = mongoose.model('Driver', driverSchema);
