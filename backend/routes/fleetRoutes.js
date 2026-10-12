const express = require('express');
const jwt = require('jsonwebtoken');
const { syncGpsPositions } = require('../services/gpsPollerService');
const { getCronWorkerStatus } = require('../services/gpsCronWorker');
const GpsSetting = require('../models/GpsSetting');

const router = express.Router();

const { getJwtSecret, verifyToken } = require('../middleware/auth');
const { timingSafeCompare } = require('../utils/security');
const { gpsSyncLimiter } = require('../middleware/rateLimiter');

/**
 * Middleware requiring either:
 * 1. Logged in user with valid Bearer token
 * 2. Vercel Cron or External Cron with verified CRON_SECRET
 */
function authorizeSyncCaller(req, res, next) {
  const authHeader = req.headers.authorization;
  const cronSecretHeader = req.headers['x-cron-secret'];
  const configuredCronSecret = process.env.CRON_SECRET;

  // 1. Check CRON_SECRET header or Bearer secret via timing-safe comparison
  if (configuredCronSecret) {
    if (cronSecretHeader && timingSafeCompare(cronSecretHeader, configuredCronSecret)) {
      req.syncCaller = 'Cron Worker (Secret Verified)';
      return next();
    }
    if (authHeader && authHeader.startsWith('Bearer ') && timingSafeCompare(authHeader.slice(7).trim(), configuredCronSecret)) {
      req.syncCaller = 'Cron Worker (Bearer Secret Verified)';
      return next();
    }
  }

  // 2. Check JWT User Token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
      req.user = decoded;
      req.syncCaller = `Manual (${decoded.name || decoded.username || 'User'})`;
      return next();
    } catch (err) {
      return res.status(401).json({
        error: 'Invalid authentication token.',
        code: 'TOKEN_INVALID',
      });
    }
  }

  // Reject unauthenticated requests
  return res.status(401).json({
    error: 'Authentication required. Please provide a valid Bearer token or x-cron-secret header.',
    code: 'UNAUTHORIZED_SYNC_TRIGGER',
  });
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
router.post('/sync-gps', gpsSyncLimiter, authorizeSyncCaller, handleSyncGps);

// GET /api/fleet/sync-gps - Trigger GPS sync (Vercel Cron & HTTP health/runners)
router.get('/sync-gps', gpsSyncLimiter, authorizeSyncCaller, handleSyncGps);

// Middleware for status checking (Accepts JWT token or CRON_SECRET)
function authorizeStatusView(req, res, next) {
  const authHeader = req.headers.authorization;
  const cronSecretHeader = req.headers['x-cron-secret'];
  const configuredCronSecret = process.env.CRON_SECRET;

  if (configuredCronSecret && cronSecretHeader && timingSafeCompare(cronSecretHeader, configuredCronSecret)) {
    return next();
  }
  return verifyToken(req, res, next);
}

// GET /api/fleet/sync-status - View current background cron & sync state
router.get('/sync-status', authorizeStatusView, async (req, res) => {
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
router.get('/status', authorizeStatusView, async (req, res) => {
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
