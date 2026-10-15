const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema(
  {
    vehicleNumber: {
      type: String,
      required: [true, 'Vehicle number is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    driverName: {
      type: String,
      trim: true,
      default: '',
    },
    mobile: {
      type: String,
      trim: true,
      default: '',
    },
    fleetType: {
      type: String,
      required: [true, 'Fleet type is required'],
      enum: ['Own Fleet', 'Hired', 'Rental'],
    },
    ownerName: {
      type: String,
      trim: true,
      default: '',
    },
    gpsDeviceId: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
    assignedDriverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null,
    },
    assignmentType: {
      type: String,
      enum: ['MANUAL', 'AUTO_GPS', 'NONE'],
      default: 'NONE',
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    matchingDrivers: [
      {
        id: String,
        driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
        driverName: String,
        dlNumber: String,
        mobileNumber: String,
        photo: { type: String, default: null },
        distanceMeters: Number,
        radiusFromVehicleMeter: Number,
        lastLocationAt: { type: Date, default: null },
      },
    ],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Vehicle', vehicleSchema);
