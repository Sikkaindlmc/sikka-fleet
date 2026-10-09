const express = require('express');
const jwt = require('jsonwebtoken');
const { syncGpsPositions } = require('../services/gpsPollerService');
const { getCronWorkerStatus } = require('../services/gpsCronWorker');
const GpsSetting = require('../models/GpsSetting');

const router = express.Router();

/**
 * Middleware allowing either:
 * 1. Logged in user with valid Bearer token
 * 2. Vercel Cron or External Cron with CRON_SECRET
 * 3. Server-side or direct invocation if no CRON_SECRET configured
 */
function authorizeSyncCaller(req, res, next) {
  const authHeader = req.headers.authorization;
  const cronSecretHeader = req.headers['x-cron-secret'];
  const configuredCronSecret = process.env.CRON_SECRET;

  // 1. Check CRON_SECRET header or Bearer secret
  if (configuredCronSecret) {
    if (cronSecretHeader === configuredCronSecret) {
      req.syncCaller = 'Cron Worker (Secret Verified)';
      return next();
    }
    if (authHeader && authHeader === `Bearer ${configuredCronSecret}`) {
      req.syncCaller = 'Cron Worker (Bearer Secret Verified)';
      return next();
    }
  }

  // 2. Check JWT User Token if provided
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'sikka_fleet_super_secret_jwt_key_2025'
      );
      req.user = decoded;
      req.syncCaller = `Manual (${decoded.name || decoded.username || 'User'})`;
      return next();
    } catch (err) {
      // If token provided was invalid and CRON_SECRET was required, reject
      if (configuredCronSecret) {
        return res.status(401).json({ error: 'Invalid authentication token.' });
      }
    }
  }

  // 3. Fallback for internal cron/server triggers
  req.syncCaller = 'Automated Background Sync';
  next();
}

/**
 * Common handler for /api/fleet/sync-gps
 * Triggered by both:
 * - Server-side / Cloud cron jobs (every 30 mins)
 * - Frontend "Sync GPS Now" button
 */
async function handleSyncGps(req, res) {
  try {
    const caller = req.syncCaller || (req.user ? `Manual (${req.user.name || req.user.username})` : 'API Trigger');
    console.log(`[API /api/fleet/sync-gps] Triggered by: ${caller}`);

    const result = await syncGpsPositions(caller);

    return res.json({
      success: true,
      message: 'GPS synchronization completed successfully.',
      last_evaluated_timestamp: result.last_evaluated_timestamp,
      lastSync: result.lastSync,
      next_sync_timestamp: result.next_sync_timestamp,
      processedCount: result.processedCount || result.vehiclesProcessed || 0,
      syncType: result.syncType || result.triggerType,
    });
  } catch (error) {
    console.error('[API /api/fleet/sync-gps Error]:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'GPS synchronization failed.',
    });
  }
}

// POST /api/fleet/sync-gps - Trigger GPS sync (Frontend button & automated webhooks)
router.post('/sync-gps', authorizeSyncCaller, handleSyncGps);

// GET /api/fleet/sync-gps - Trigger GPS sync (Vercel Cron & HTTP health/runners)
router.get('/sync-gps', authorizeSyncCaller, handleSyncGps);

// GET /api/fleet/sync-status - View current background cron & sync state
router.get('/sync-status', async (req, res) => {
  try {
    const status = await getCronWorkerStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve sync status.' });
  }
});

// GET /api/fleet/status - Alias for sync-status
router.get('/status', async (req, res) => {
  try {
    const status = await getCronWorkerStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve sync status.' });
  }
});

module.exports = router;
