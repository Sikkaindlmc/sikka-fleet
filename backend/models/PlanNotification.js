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
    planType: {
      type: String,
      enum: ['Add Plan', 'Next Trip Plan'],
      default: 'Add Plan',
      index: true,
    },
    activityType: {
      type: String,
      enum: ['PLAN_CREATED', 'PLAN_DELETED'],
      default: 'PLAN_CREATED',
      index: true,
    },
    planId: {
      type: String,
      default: null,
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
    planCreatedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: String,
      default: null,
      trim: true,
    },
    deletedByUsername: {
      type: String,
      default: null,
      trim: true,
    },
    deletedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    deletedAt: {
      type: Date,
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
    },
    expiresAt: {
      type: Date,
      default: null,
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

// MongoDB TTL index: automatically deletes document once expiresAt timestamp is reached
planNotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PlanNotification', planNotificationSchema);
