const express = require('express');
const { executeGpsSyncForBothProviders } = require('../services/gpsSyncService');
const { getCronWorkerStatus } = require('../services/gpsCronWorker');
const GpsSetting = require('../models/GpsSetting');

const router = express.Router();

const { verifyToken } = require('../middleware/auth');
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
      req.isCron = true;
      return next();
    }
    if (authHeader && authHeader.startsWith('Bearer ') && timingSafeCompare(authHeader.slice(7).trim(), configuredCronSecret)) {
      req.syncCaller = 'Cron Worker (Bearer Secret Verified)';
      req.isCron = true;
      return next();
    }
  }

  // 2. Check JWT User Token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return verifyToken(req, res, () => {
      if (req.user.role !== 'Admin') {
        return res.status(403).json({
          error: 'Only administrators can trigger an on-demand GPS synchronization.',
          code: 'ADMIN_REQUIRED',
        });
      }
      req.syncCaller = `On-demand user (${req.user.fullName || req.user.username || 'User'})`;
      req.isCron = false;
      next();
    });
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
    const source = req.isCron ? 'AUTO' : 'GPS-AUTO';
    const triggerType = req.isCron ? 'WEBHOOK_CRON' : 'USER_TRIGGER';
    console.log(`[API /api/fleet/sync-gps] Triggered by: ${req.syncCaller || source}`);

    const result = await executeGpsSyncForBothProviders({ source, triggerType });

    return res.status(result.success ? 200 : 207).json({
      success: result.success,
      message: result.message,
      providerResults: result.providerResults,
      last_evaluated_timestamp: result.providerResults.find((item) => item.provider === 'WheelsEye GPS')?.last_evaluated_timestamp || null,
      lastSync: result.providerResults.find((item) => item.provider === 'WheelsEye GPS')?.lastSync || null,
      next_sync_timestamp: result.providerResults.find((item) => item.provider === 'WheelsEye GPS')?.next_sync_timestamp || null,
      processedCount: result.providerResults.reduce((total, item) => total + (item.processedCount || item.vehiclesProcessed || 0), 0),
      syncType: triggerType,
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
