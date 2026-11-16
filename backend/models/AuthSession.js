const mongoose = require('mongoose');

const authSessionSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    accountType: {
      type: String,
      enum: ['User', 'Driver'],
      required: true,
    },
    refreshHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AuthSession', authSessionSchema);
