const cron = require('node-cron');
const { executeWheelseyeAutoSync } = require('./wheelseyeAutoSyncService');
const GpsSetting = require('../models/GpsSetting');

let cronJob = null;
let lastCronRunTime = null;
let lastCronStatus = 'Idle';
let lastCronError = null;

/**
 * Calculates the exact next fixed 30-minute block boundary in Indian Standard Time (IST).
 * Fixed Schedule Slots: HH:00:00 IST and HH:30:00 IST every hour.
 */
function getNextFixed30MinSlot(date = new Date()) {
  const d = new Date(date);
  const minutes = d.getMinutes();
  const target = new Date(d);

  if (minutes < 30) {
    target.setMinutes(30, 0, 0);
  } else {
    target.setHours(target.getHours() + 1, 0, 0, 0);
  }

  // Ensure target is strictly in the future
  if (target.getTime() <= d.getTime()) {
    target.setMinutes(target.getMinutes() + 30, 0, 0);
  }

  return target;
}

/**
 * Initializes and starts the background GPS sync worker.
 * Runs strictly every 30 minutes fixed to Indian Standard Time (IST / Asia/Kolkata).
 * Fixed Schedule Slots: HH:00:00 IST and HH:30:00 IST every hour.
 * Operates 24/7 server-side regardless of client/browser state.
 */
function startGpsCronWorker() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }

  console.log('===========================================================');
  console.log('⏱️  [GPS Cron Worker IST] Fixed Schedule: HH:00:00 and HH:30:00 IST (Asia/Kolkata)');
  console.log('🌐 Operates 24/7 server-side independent of browser or user login');
  console.log('===========================================================');

  // Schedule task strictly at minute 0 and minute 30 in Asia/Kolkata timezone
  cronJob = cron.schedule(
    '0,30 * * * *',
    async () => {
      const startedAt = new Date();
      lastCronRunTime = startedAt;
      lastCronStatus = 'Running';
      const istString = startedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      console.log(`[GPS Cron Worker IST] [${istString}] Triggering automated 30-minute Wheelseye GPS sync & geofence recalculation...`);

      try {
        const result = await executeWheelseyeAutoSync('CRON_WORKER_IST');
        lastCronStatus = 'Success';
        lastCronError = null;
        console.log(`[GPS Cron Worker IST] [${istString}] Completed successfully. Processed ${result.vehiclesProcessed} vehicles in ${result.durationMs}ms.`);
      } catch (err) {
        lastCronStatus = 'Failed';
        lastCronError = err.message;
        console.error('[GPS Cron Worker IST Error]:', err.message);
      }

      // Auto-remove Plant Plan Notifications older than 48 hours
      try {
        const PlanNotification = require('../models/PlanNotification');
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const delRes = await PlanNotification.deleteMany({ createdAt: { $lt: cutoff } });
        if (delRes.deletedCount > 0) {
          console.log(`[GPS Cron Worker IST] Auto-removed ${delRes.deletedCount} expired plan notifications (>48h).`);
        }
      } catch (cleanupErr) {
        console.warn('[PlanNotification 48h Cleanup Warning]:', cleanupErr.message);
      }
    },
    {
      timezone: 'Asia/Kolkata',
    }
  );

  // Execute initial startup sync on worker launch to ensure fresh data
  executeWheelseyeAutoSync('STARTUP_SYNC')
    .then((result) => {
      lastCronRunTime = new Date();
      lastCronStatus = 'Success';
      console.log(`[GPS Cron Worker IST] Startup GPS sync completed. Processed ${result.vehiclesProcessed} active vehicles.`);
    })
    .catch((err) => {
      lastCronStatus = 'Startup Failed';
      lastCronError = err.message;
      console.error('[GPS Cron Worker Startup Error]:', err.message);
    });
}

function stopGpsCronWorker() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    lastCronStatus = 'Stopped';
    console.log('[GPS Cron Worker IST] Stopped.');
  }
}

async function getCronWorkerStatus() {
  const setting = await GpsSetting.findOne().sort({ updatedAt: -1 });
  const lastEvaluated = setting?.last_evaluated_timestamp || setting?.lastSync || lastCronRunTime || null;
  const nextSync = getNextFixed30MinSlot(new Date());

  return {
    isRunning: Boolean(cronJob),
    schedule: '0,30 * * * * (Asia/Kolkata)',
    intervalMinutes: 30,
    lastRunTime: lastCronRunTime,
    lastEvaluatedTimestamp: lastEvaluated,
    nextSyncTimestamp: nextSync,
    status: lastCronStatus,
    lastError: lastCronError,
    connectionStatus: setting?.connectionStatus || 'Connected',
    provider: setting?.provider || 'WheelsEye GPS',
  };
}

module.exports = {
  startGpsCronWorker,
  stopGpsCronWorker,
  getCronWorkerStatus,
  getNextFixed30MinSlot,
};
