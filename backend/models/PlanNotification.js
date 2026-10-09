const mongoose = require('mongoose');

const planNotificationSchema = new mongoose.Schema(
  {
    plantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plant',
      default: null,
      index: true,
    },
    plantName: {
      type: String,
      required: true,
      trim: true,
      default: 'Plant',
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      index: true,
    },
    vehicleNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    planBy: {
      type: String,
      required: true,
      trim: true,
      default: 'Sikka Team',
    },
    planByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    location: {
      type: String,
      default: 'Plant Location',
      trim: true,
    },
    latitude: {
      type: Number,
      default: null,
    },
    longitude: {
      type: Number,
      default: null,
    },
    planNote: {
      type: String,
      required: true,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
      expires: 172800, // Auto-remove from database after 48 hours (48 * 60 * 60 seconds)
    },
    readBy: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    collection: 'plan_notifications',
    timestamps: true,
  }
);

// Compound index for deduplication and quick sorting
planNotificationSchema.index({ vehicleId: 1, createdAt: -1 });

module.exports = mongoose.model('PlanNotification', planNotificationSchema);
