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
    currentPlantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      default: null,
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
  }
);

module.exports = mongoose.model('VehicleCurrentStatus', vehicleCurrentStatusSchema);
