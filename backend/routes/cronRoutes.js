const express = require('express');
const { executeWheelseyeAutoSync } = require('../services/wheelseyeAutoSyncService');
const CronExecutionLog = require('../models/CronExecutionLog');
const GpsSetting = require('../models/GpsSetting');

const router = express.Router();

/**
 * Middleware: Verify CRON_SECRET for security
 * Protects against unauthorized manual triggering of background cron jobs.
 */
function verifyCronSecret(req, res, next) {
  const configuredSecret = process.env.CRON_SECRET || 'sikka_fleet_cron_secure_key_2026';

  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const xCronSecret = req.headers['x-cron-secret'];

  if (bearerToken === configuredSecret || xCronSecret === configuredSecret) {
    req.cronCaller = 'Authorized Cron Runner';
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized: Invalid or missing CRON_SECRET header.',
  });
}

/**
 * Common handler for /api/cron/sync-gps
 * Triggered by Vercel Cron, external webhook runner, or local cron scheduler.
 */
async function handleCronSync(req, res) {
  try {
    const triggerType = req.headers['x-vercel-id'] ? 'VERCEL_CRON' : 'CRON_WORKER_IST';
    console.log(`[API /api/cron/sync-gps] Triggered via ${triggerType} (${req.cronCaller || 'Caller'})`);

    const result = await executeWheelseyeAutoSync(triggerType);

    return res.json({
      success: true,
      message: 'Wheelseye GPS cron synchronization executed successfully.',
      ...result,
    });
  } catch (error) {
    console.error('[API /api/cron/sync-gps Error]:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Wheelseye GPS cron sync failed.',
    });
  }
}

// POST /api/cron/sync-gps - Scheduled automated background GPS sync
router.post('/sync-gps', verifyCronSecret, handleCronSync);

// GET /api/cron/sync-gps - Vercel Cron sends GET requests
router.get('/sync-gps', verifyCronSecret, handleCronSync);

// GET /api/cron/logs - Query recent 30-minute cron execution logs for verification
router.get('/logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const logs = await CronExecutionLog.find().sort({ startedAt: -1 }).limit(limit);
    const setting = await GpsSetting.findOne().sort({ updatedAt: -1 });

    res.json({
      success: true,
      count: logs.length,
      lastEvaluatedTimestamp: setting?.last_evaluated_timestamp || null,
      logs,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to retrieve cron execution logs.' });
  }
});

module.exports = router;
