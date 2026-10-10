const cron = require('node-cron');
const { executeGpsSync, getNextFixed30MinSlotIST } = require('./gpsSyncService');
const GpsSetting = require('../models/GpsSetting');
const PlanNotification = require('../models/PlanNotification');

let cronJob = null;
let heartbeatTimer = null;
let lastSlotExecuted = null; // String identifier of last completed IST slot e.g. "2026-10-10_14:30"
let isSchedulerRunning = false;
let retryScheduledTimer = null;

/**
 * Returns current IST slot identifier (e.g. "2026-10-10_14:00" or "2026-10-10_14:30").
 */
function getCurrentIstSlotKey(refDate = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(refDate);

  const m = {};
  for (const p of parts) m[p.type] = p.value;

  const hour = m.hour === '24' ? '00' : m.hour;
  const minute = parseInt(m.minute, 10);
  const slotMin = minute < 30 ? '00' : '30';

  return `${m.year}-${m.month}-${m.day}_${hour}:${slotMin}`;
}

/**
 * Triggers automated 30-minute GPS sync execution.
 */
async function runScheduledGpsSync(triggerType = 'GPS_AUTO_SYNC_30MIN') {
  const now = new Date();
  const istString = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const currentSlot = getCurrentIstSlotKey(now);

  console.log(`[GPS Scheduler IST] [${istString}] Triggering server-side 30-minute sync (Slot: ${currentSlot})...`);

  try {
    const result = await executeGpsSync({
      source: 'AUTO',
      triggerType,
    });

    if (result && !result.inProgress) {
      lastSlotExecuted = currentSlot;
    }

    // Auto-cleanup expired plan notifications older than 48 hours
    try {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const del = await PlanNotification.deleteMany({ createdAt: { $lt: cutoff } });
      if (del.deletedCount > 0) {
        console.log(`[GPS Scheduler] Cleaned up ${del.deletedCount} expired plan notifications (>48h).`);
      }
    } catch (cleanupErr) {
      // Non-critical
    }

    return result;
  } catch (err) {
    console.error(`[GPS Scheduler IST Error] Sync failed: ${err.message}`);

    // Schedule retry attempt after 3 minutes if not already scheduled (Requirement 4)
    if (!retryScheduledTimer) {
      console.log(`[GPS Scheduler IST] Scheduling automatic retry in 3 minutes...`);
      retryScheduledTimer = setTimeout(async () => {
        retryScheduledTimer = null;
        console.log(`[GPS Scheduler IST] Executing automatic retry...`);
        try {
          await executeGpsSync({ source: 'AUTO', triggerType: 'GPS_AUTO_SYNC_RETRY' });
        } catch (retryErr) {
          console.error(`[GPS Scheduler IST Retry Error]: ${retryErr.message}`);
        }
      }, 3 * 60 * 1000);
    }

    throw err;
  }
}

/**
 * Starts the 24x7 Server-Side Scheduler.
 * Operates completely independently of browser, dashboard, or user login (Requirement 3).
 */
function startGpsScheduler() {
  if (isSchedulerRunning) {
    console.log('[GPS Scheduler] Already active and running.');
    return;
  }

  console.log('===========================================================');
  console.log('⏱️  [GPS 30-Min Scheduler] Initializing Server-Side Job (Asia/Kolkata)');
  console.log('🌐 Fixed Slots: HH:00:00 IST and HH:30:00 IST (24x7 Autonomous)');
  console.log('🔒 Independent of browser, dashboard, user session, or client PC');
  console.log('===========================================================');

  // Layer 1: Node-Cron on minute 0 and 30 in Asia/Kolkata timezone
  try {
    cronJob = cron.schedule(
      '0,30 * * * *',
      async () => {
        await runScheduledGpsSync('CRON_WORKER_IST');
      },
      {
        timezone: 'Asia/Kolkata',
      }
    );
  } catch (cronInitErr) {
    console.error('[GPS Scheduler Cron Init Warning]:', cronInitErr.message);
  }

  // Layer 2: Autonomous Heartbeat Monitor (Runs every 15 seconds)
  // Handles missed schedules, server downtime recovery, clock drift, process restarts (Requirement 4 & 17)
  heartbeatTimer = setInterval(async () => {
    try {
      const now = new Date();
      const currentSlot = getCurrentIstSlotKey(now);

      // Check when last successful sync occurred from database
      const setting = await GpsSetting.findOne().sort({ updatedAt: -1 });
      const lastSync = setting?.last_evaluated_timestamp || setting?.lastSync || null;
      const timeSinceLastSyncMs = lastSync ? now.getTime() - new Date(lastSync).getTime() : Infinity;

      // Determine minutes in current IST hour
      const istParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        minute: 'numeric',
      }).formatToParts(now);
      const curMinute = parseInt(istParts.find((p) => p.type === 'minute')?.value || '0', 10);

      // If we are at minute 0, 1, 30, or 31 and current slot hasn't executed yet
      const isSlotBoundary = curMinute === 0 || curMinute === 1 || curMinute === 30 || curMinute === 31;
      const slotMissed = lastSlotExecuted !== currentSlot && timeSinceLastSyncMs > 25 * 60 * 1000;

      // Or if more than 35 minutes have passed since the last sync
      const severelyOverdue = timeSinceLastSyncMs > 35 * 60 * 1000;

      if ((isSlotBoundary && slotMissed) || severelyOverdue) {
        console.log(
          `[GPS Scheduler Heartbeat] Missed slot or boundary detected (Slot: ${currentSlot}, elapsed: ${Math.round(timeSinceLastSyncMs / 60000)}m). Catching up...`
        );
        await runScheduledGpsSync('AUTONOMOUS_HEARTBEAT_IST');
      }
    } catch (heartbeatErr) {
      // Non-blocking log
    }
  }, 15 * 1000);

  isSchedulerRunning = true;

  // Layer 3: Initial Startup Sync Check on server restart (Requirement 17)
  (async () => {
    try {
      const setting = await GpsSetting.findOne().sort({ updatedAt: -1 });
      const lastSync = setting?.last_evaluated_timestamp || setting?.lastSync || null;
      const elapsedMs = lastSync ? Date.now() - new Date(lastSync).getTime() : Infinity;

      if (!lastSync || elapsedMs > 25 * 60 * 1000) {
        console.log(`[GPS Scheduler] Startup check: Telemetry data missing or >25m old. Executing initial sync...`);
        await runScheduledGpsSync('STARTUP_SYNC');
      } else {
        const istNext = getNextFixed30MinSlotIST(new Date());
        console.log(`[GPS Scheduler] Startup check: Recent telemetry is fresh (${Math.round(elapsedMs / 60000)}m old). Next sync at: ${istNext.toISOString()}`);
      }
    } catch (startupErr) {
      console.warn('[GPS Scheduler Startup Sync Warning]:', startupErr.message);
    }
  })();
}

/**
 * Stops the scheduler worker.
 */
function stopGpsScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (retryScheduledTimer) {
    clearTimeout(retryScheduledTimer);
    retryScheduledTimer = null;
  }
  isSchedulerRunning = false;
  console.log('[GPS Scheduler] Stopped.');
}

module.exports = {
  startGpsScheduler,
  stopGpsScheduler,
  runScheduledGpsSync,
  getNextFixed30MinSlotIST,
};
