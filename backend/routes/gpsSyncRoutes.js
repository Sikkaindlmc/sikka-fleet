const express = require('express');
const {
  executeGpsSync,
  getAutoSyncStatus,
} = require('../services/gpsSyncService');
const GpsSyncLog = require('../models/GpsSyncLog');
const GpsSetting = require('../models/GpsSetting');

const router = express.Router();

const { verifyToken } = require('../middleware/auth');
const { timingSafeCompare } = require('../utils/security');
const { gpsSyncLimiter } = require('../middleware/rateLimiter');
const { getCurrentIstSlotKey } = require('../services/gpsScheduler');

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
    return verifyToken(req, res, () => {
      if (req.user.role !== 'Admin') {
        return res.status(403).json({
          error: 'Only administrators can trigger an on-demand GPS synchronization.',
          code: 'ADMIN_REQUIRED',
        });
      }
      req.syncCaller = `On-demand user (${req.user.username || req.user.fullName || 'User'})`;
      req.isCron = false;
      next();
    });
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
    if (source && ['AUTO', 'GPS-AUTO'].includes(source)) {
      filter.source = source;
    }

    try {
      filter.provider = /wheels.?eye/i;
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
    filter.archived = { $ne: true };
    const logs = await GpsSyncLog.find(filter)
      .select('-errorMessage')
      .sort({ startedAt: -1 })
      .limit(limit);
    const setting = await GpsSetting.findOne({
      provider: /wheels.?eye/i,
      archived: { $ne: true },
    }).sort({ updatedAt: -1 });

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
    const source = req.isCron ? 'AUTO' : 'GPS-AUTO';
    const triggerType = req.isCron ? 'WEBHOOK_CRON' : (typeof req.body?.triggerType === 'string' ? req.body.triggerType.slice(0, 50) : 'USER_TRIGGER');
    console.log(`[API /api/gps-sync/run] Triggered (Providers: WheelsEye & FleetX, Source: ${source}, Trigger: ${triggerType}, Caller: ${req.syncCaller})`);

    const { syncProviderGps } = require('../services/gpsSyncEngine');
    const [wheelseye, fleetx] = await Promise.allSettled([
      syncProviderGps({ provider: 'WHEELSEYE', mode: 'AUTO', caller: req.syncCaller }),
      syncProviderGps({ provider: 'FLEETX', mode: 'AUTO', caller: req.syncCaller }),
    ]);
    const wheelResult = wheelseye.status === 'fulfilled'
      ? wheelseye.value
      : { success: false, error: wheelseye.reason?.message };
    const fleetResult = fleetx.status === 'fulfilled'
      ? fleetx.value
      : { success: false, error: fleetx.reason?.message };
    const overallSuccess = Boolean(wheelResult.success || fleetResult.success);

    res.status(overallSuccess ? 200 : 502).json({
      success: overallSuccess,
      message: 'Independent GPS synchronization completed.',
      wheelseye: wheelResult,
      fleetx: fleetResult,
    });
  } catch (error) {
    console.error('[API /api/gps-sync/run Error]:', error);
    res.status(error.provider ? 502 : 500).json({
      success: false,
      error: error.message || 'GPS synchronization failed.',
      provider: error.provider || null,
      providerStatus: error.providerStatus || null,
    });
  }
}

// POST /api/gps-sync/run - On-demand button trigger & external runners
router.post('/run', gpsSyncLimiter, authorizeGpsSyncCaller, handleTriggerSync);

// GET /api/gps-sync/run - Vercel Cron GET runner
router.get('/run', gpsSyncLimiter, authorizeGpsSyncCaller, handleTriggerSync);

module.exports = router;
