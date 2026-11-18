const mongoose = require('mongoose');

const gpsCredentialAuditLogSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ['WheelsEye GPS'],
      required: true,
    },
    changedFields: {
      type: [{
        type: String,
        enum: ['apiUrl', 'apiCredential'],
      }],
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    collection: 'gps_credential_audit_logs',
    timestamps: true,
  }
);

module.exports = mongoose.model('GpsCredentialAuditLog', gpsCredentialAuditLogSchema);
