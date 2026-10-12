const express = require('express');
const { executeGpsSync, getAutoSyncStatus } = require('../services/gpsSyncService');
const GpsSyncLog = require('../models/GpsSyncLog');
const GpsSetting = require('../models/GpsSetting');

const router = express.Router();

const { verifyToken, getJwtSecret } = require('../middleware/auth');
const { timingSafeCompare } = require('../utils/security');
const { gpsSyncLimiter } = require('../middleware/rateLimiter');
const jwt = require('jsonwebtoken');

/**
 * Middleware: Verify caller is either an authenticated user or authorized cron worker
 */
function authorizeGpsSyncCaller(req, res, next) {
  const authHeader = req.headers.authorization;
  const cronSecretHeader = req.headers['x-cron-secret'];
  const configuredCronSecret = process.env.CRON_SECRET;

  if (configuredCronSecret) {
    if (cronSecretHeader && timingSafeCompare(cronSecretHeader, configuredCronSecret)) {
      req.syncCaller = 'Cron Worker (Secret Verified)';
      req.isCron = true;
      return next();
    }
    if (authHeader && authHeader.startsWith('Bearer ') && timingSafeCompare(authHeader.slice(7).trim(), configuredCronSecret)) {
      req.syncCaller = 'Cron Worker (Bearer Secret Verified)';
      req.isCron = true;
      return next();
    }
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
      req.user = decoded;
      req.syncCaller = `User (${decoded.username || decoded.fullName || 'User'})`;
      req.isCron = false;
      return next();
    } catch (err) {
      return res.status(401).json({
        error: 'Invalid authentication token.',
        code: 'TOKEN_INVALID',
      });
    }
  }

  return res.status(401).json({
    error: 'Authentication required to trigger GPS synchronization.',
    code: 'UNAUTHORIZED_SYNC',
  });
}

/**
 * GET /api/gps-sync/status (Requirement 10)
 * Returns server-side scheduler status, last sync, next scheduled sync IST, and processed vehicle counts.
 */
router.get('/status', (req, res, next) => {
  const configuredCronSecret = process.env.CRON_SECRET;
  const cronSecretHeader = req.headers['x-cron-secret'];
  if (configuredCronSecret && cronSecretHeader && timingSafeCompare(cronSecretHeader, configuredCronSecret)) {
    return next();
  }
  return verifyToken(req, res, next);
}, async (req, res) => {
  try {
    const status = await getAutoSyncStatus();
    res.json(status);
  } catch (error) {
    console.error('[API /api/gps-sync/status Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve auto-sync status.' });
  }
});

/**
 * GET /api/gps-sync/logs (Requirement 11)
 * Retrieves recent execution logs for auto-sync inspection and audit.
 */
router.get('/logs', (req, res, next) => {
  const configuredCronSecret = process.env.CRON_SECRET;
  const cronSecretHeader = req.headers['x-cron-secret'];
  if (configuredCronSecret && cronSecretHeader && timingSafeCompare(cronSecretHeader, configuredCronSecret)) {
    return next();
  }
  return verifyToken(req, res, next);
}, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const source = req.query.source ? req.query.source.toUpperCase() : null;

    const filter = {};
    if (source && ['AUTO', 'MANUAL'].includes(source)) {
      filter.source = source;
    }

    const logs = await GpsSyncLog.find(filter).sort({ startedAt: -1 }).limit(limit);
    const setting = await GpsSetting.findOne().sort({ updatedAt: -1 });

    res.json({
      success: true,
      count: logs.length,
      lastEvaluatedTimestamp: setting?.last_evaluated_timestamp || null,
      logs,
    });
  } catch (error) {
    console.error('[API /api/gps-sync/logs Error]:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve sync logs.' });
  }
});

/**
 * Handler for manual and external webhook triggers.
 */
async function handleTriggerSync(req, res) {
  try {
    const source = req.isCron ? 'AUTO' : 'MANUAL';
    const triggerType = req.isCron ? 'WEBHOOK_CRON' : (typeof req.body?.triggerType === 'string' ? req.body.triggerType.slice(0, 50) : 'MANUAL_TRIGGER');

    console.log(`[API /api/gps-sync/run] Triggered (Source: ${source}, Trigger: ${triggerType}, Caller: ${req.syncCaller})`);

    const result = await executeGpsSync({
      source,
      triggerType,
    });

    res.json({
      success: true,
      message: 'Wheelseye GPS synchronization executed successfully.',
      ...result,
    });
  } catch (error) {
    console.error('[API /api/gps-sync/run Error]:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'GPS synchronization failed.',
    });
  }
}

// POST /api/gps-sync/run - Manual button trigger & external runners
router.post('/run', gpsSyncLimiter, authorizeGpsSyncCaller, handleTriggerSync);

// GET /api/gps-sync/run - Vercel Cron GET runner
router.get('/run', gpsSyncLimiter, authorizeGpsSyncCaller, handleTriggerSync);

module.exports = router;
