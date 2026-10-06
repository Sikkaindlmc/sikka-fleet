const mongoose = require('mongoose');

const AiChatHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    userRole: {
      type: String,
      enum: ['Admin', 'User'],
      default: 'User',
    },
    question: {
      type: String,
      required: true,
      trim: true,
    },
    answer: {
      type: String,
      required: true,
    },
    relevantVehicle: {
      type: String,
      default: null,
      trim: true,
    },
    relevantDriver: {
      type: String,
      default: null,
      trim: true,
    },
    relevantPlant: {
      type: String,
      default: null,
      trim: true,
    },
    questionDate: {
      type: String,
      required: true,
    },
    questionTime: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // Exactly 24 hours from creation
    },
  },
  {
    timestamps: false,
  }
);

// TTL Index: Automatically permanently delete document 0 seconds after `expiresAt`
AiChatHistorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AiChatHistory', AiChatHistorySchema);
