const mongoose = require('mongoose');

const sikkaAiAuditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    username: { type: String, default: '' },
    action: { type: String, enum: ['sync_gps', 'get_vehicle_location'], default: undefined },
    toolNames: {
      type: [{ type: String, enum: ['sync_gps', 'get_vehicle_location'] }],
      default: [],
    },
    queryHash: { type: String, required: true },
    status: { type: String, enum: ['STARTED', 'SUCCESS', 'PARTIAL', 'FAILED', 'DENIED'], default: 'STARTED' },
    resultCount: { type: Number, default: 0 },
    errorCode: { type: String, default: '' },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { collection: 'sikka_ai_audit_logs', timestamps: true }
);

sikkaAiAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SikkaAiAuditLog', sikkaAiAuditLogSchema);
