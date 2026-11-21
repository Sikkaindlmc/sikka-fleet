const mongoose = require('mongoose');

const sikkaAiSyncCooldownSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    lastTriggeredAt: { type: Date, required: true },
  },
  { collection: 'sikka_ai_sync_cooldowns', timestamps: true }
);

module.exports = mongoose.model('SikkaAiSyncCooldown', sikkaAiSyncCooldownSchema);
