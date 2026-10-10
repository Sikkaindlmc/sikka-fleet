const express = require('express');
const { executeGpsSync, getAutoSyncStatus } = require('../services/gpsSyncService');
const GpsSyncLog = require('../models/GpsSyncLog');
const GpsSetting = require('../models/GpsSetting');

const router = express.Router();

/**
 * GET /api/gps-sync/status (Requirement 10)
 * Returns server-side scheduler status, last sync, next scheduled sync IST, and processed vehicle counts.
 */
router.get('/status', async (req, res) => {
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
router.get('/logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const source = req.query.source ? req.query.source.toUpperCase() : null;

    const filter = {};
    if (source) filter.source = source;

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
    const authHeader = req.headers.authorization;
    const isCron = req.headers['x-cron-secret'] || (authHeader && authHeader.includes(process.env.CRON_SECRET || 'cron'));
    const source = isCron ? 'AUTO' : 'MANUAL';
    const triggerType = isCron ? 'WEBHOOK_CRON' : (req.body?.triggerType || 'MANUAL_TRIGGER');

    console.log(`[API /api/gps-sync/run] Triggered (Source: ${source}, Trigger: ${triggerType})`);

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
router.post('/run', handleTriggerSync);

// GET /api/gps-sync/run - Vercel Cron GET runner
router.get('/run', handleTriggerSync);

module.exports = router;
