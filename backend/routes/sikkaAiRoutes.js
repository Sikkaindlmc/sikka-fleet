const express = require('express');
const Vehicle = require('../models/Vehicle');
const SikkaAiAuditLog = require('../models/SikkaAiAuditLog');
const SikkaAiSyncCooldown = require('../models/SikkaAiSyncCooldown');
const { verifyToken } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const {
  ALLOWED_AI_ACTIONS,
  UNSUPPORTED_MESSAGE,
  executeToolCall,
  formatToolAnswer,
  getSyncNotice,
  hashQuery,
  recognizeQuestion,
} = require('../services/sikkaAiService');

const router = express.Router();
const MAX_QUESTION_LENGTH = 1000;
const AI_SYNC_COOLDOWN_MS = 60 * 1000;
const AI_SYNC_COOLDOWN_KEY = 'gps-sync';
const SAFE_ACTION_ERROR_CODES = new Set([
  'ADMIN_REQUIRED',
  'AI_SYNC_COOLDOWN',
  'INVALID_PROVIDER',
  'LOGIN_FAILED',
  'NO_VEHICLES',
  'VEHICLE_NOT_MATCHED',
  'INVALID_COORDINATES',
  'GPS_TIMESTAMP_MISSING',
  'FUTURE_GPS_TIMESTAMP',
  'REQUEST_TIMEOUT',
  'REQUEST_FAILED',
  'SYNC_FAILED',
]);

function getSafeErrorCode(error) {
  const status = Number(error?.response?.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) return `HTTP_${status}`;
  const code = String(error?.code || '').toUpperCase();
  if (/^MISSING_ENV_[A-Z0-9_]{2,60}$/.test(code)) return code;
  if (/^HTTP_\d{3}$/.test(code)) return code;
  return SAFE_ACTION_ERROR_CODES.has(code) ? code : 'AI_QUERY_FAILED';
}

async function reserveAiSync(now = new Date()) {
  try {
    const reservation = await SikkaAiSyncCooldown.findOneAndUpdate(
      {
        key: AI_SYNC_COOLDOWN_KEY,
        $or: [
          { lastTriggeredAt: { $lte: new Date(now.getTime() - AI_SYNC_COOLDOWN_MS) } },
          { lastTriggeredAt: { $exists: false } },
        ],
      },
      { $set: { lastTriggeredAt: now } },
      { new: true, upsert: true }
    ).lean();
    return Boolean(reservation);
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

function requireSikkaFleetAccess(req, res, next) {
  if (req.user?.role === 'Admin' ||
      (Array.isArray(req.user?.accessPages) && req.user.accessPages.length > 0)) {
    return next();
  }
  return res.status(403).json({ error: 'You do not have access to Sikka Fleet pages.' });
}

async function saveAudit(audit) {
  try {
    await audit.save();
  } catch (error) {
    console.error('[Sikka AI] Audit write failed:', getSafeErrorCode(error));
    throw error;
  }
}

router.use(verifyToken, requireSikkaFleetAccess);

router.post('/query', aiLimiter, async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({
      error: `Enter a question between 1 and ${MAX_QUESTION_LENGTH} characters.`,
    });
  }

  const intent = recognizeQuestion(question);
  const action = ALLOWED_AI_ACTIONS.includes(intent.tool) ? intent.tool : null;
  const audit = new SikkaAiAuditLog({
    userId: req.user._id || req.user.id,
    username: String(req.user.username || '').slice(0, 100),
    ...(action ? { action } : {}),
    toolNames: action ? [action] : [],
    queryHash: hashQuery(question),
    status: action ? 'STARTED' : 'DENIED',
    errorCode: action ? '' : 'UNSUPPORTED_ACTION',
  });

  try {
    await saveAudit(audit);
    if (!action) {
      audit.completedAt = new Date();
      await saveAudit(audit);
      return res.json({ answer: UNSUPPORTED_MESSAGE, syncNotice: null });
    }

    if (action === 'sync_gps' && req.user.role !== 'Admin') {
      audit.status = 'DENIED';
      audit.errorCode = 'ADMIN_REQUIRED';
      audit.completedAt = new Date();
      await saveAudit(audit);
      return res.status(403).json({ error: 'Only administrators can start GPS synchronization from Sikka AI.' });
    }

    if (action === 'sync_gps' && !await reserveAiSync()) {
      audit.status = 'DENIED';
      audit.errorCode = 'AI_SYNC_COOLDOWN';
      audit.completedAt = new Date();
      await saveAudit(audit);
      return res.status(429).json({ error: 'GPS sync is limited to once per minute. Please try again shortly.' });
    }

    if (req.user.role === 'Driver' && action === 'get_vehicle_location') {
      const assignedVehicle = await Vehicle.findOne({
        assignedDriverId: req.user._id || req.user.id,
        status: 'Active',
      }).select('vehicleNumber').lean();
      intent.args.vehicleNumber = assignedVehicle?.vehicleNumber || null;
    }

    const data = await executeToolCall({ name: action, args: intent.args }, req.user);
    const results = [{ tool: action, data }];
    audit.status = action === 'sync_gps'
      ? Object.values(data).every((provider) => provider.status === 'FAILED')
        ? 'FAILED'
        : Object.values(data).some((provider) => provider.status === 'FAILED' || provider.status === 'PARTIAL')
          ? 'PARTIAL'
          : 'SUCCESS'
      : data.message
        ? 'FAILED'
        : 'SUCCESS';
    audit.resultCount = action === 'sync_gps'
      ? Object.keys(data).length
      : data.vehicleNumber ? 1 : 0;
    audit.completedAt = new Date();
    await saveAudit(audit);

    return res.json({
      answer: formatToolAnswer(results),
      syncNotice: getSyncNotice(results),
    });
  } catch (error) {
    audit.status = 'FAILED';
    audit.errorCode = getSafeErrorCode(error);
    audit.completedAt = new Date();
    try {
      await saveAudit(audit);
    } catch (auditError) {
      console.error('[Sikka AI] Failed to record action failure:', getSafeErrorCode(auditError));
    }
    console.error('[Sikka AI] Action failed:', audit.errorCode);
    return res.status(500).json({
      error: 'Sikka AI could not complete the request. Please try again or contact your administrator.',
    });
  }
});

module.exports = router;
