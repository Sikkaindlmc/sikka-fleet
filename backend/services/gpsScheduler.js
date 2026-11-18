const cron = require('node-cron');
const { executeGpsSync, getNextFixed30MinSlotIST } = require('./gpsSyncService');
const GpsSetting = require('../models/GpsSetting');
const PlanNotification = require('../models/PlanNotification');
const { cleanupExpiredPlans } = require('../utils/planHelper');

let cronJob = null;
let heartbeatTimer = null;
let lastSlotAttempted = null;
let isSchedulerRunning = false;

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
async function runScheduledGpsSync(triggerType = 'GPS_AUTO_SYNC_30MIN', slotKey = getCurrentIstSlotKey()) {
  const now = new Date();
  const istString = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const currentSlot = getCurrentIstSlotKey(now);

  console.log(`[GPS Scheduler IST] [${istString}] Triggering server-side 30-minute sync (Slot: ${currentSlot})...`);

  try {
    const result = await executeGpsSync({
      source: 'AUTO',
      triggerType,
      slotKey,
    });
    if (!result.success) {
      console.error('[GPS Scheduler] WheelsEye synchronization failed.', result.message);
    }

    // Auto-cleanup expired plans (Add Plan >12h, Next Trip Plan >24h)
    try {
      await cleanupExpiredPlans();
    } catch (cleanupErr) {
      console.warn('[GPS Scheduler Cleanup Warning]:', cleanupErr.message);
    }

    return result;
  } catch (err) {
    console.error(`[GPS Scheduler IST Error] Sync failed: ${err.message}`);
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

  // Initial cleanup of expired plans on scheduler startup (Add Plan >12h, Next Trip Plan >24h)
  cleanupExpiredPlans().catch((err) => {
    console.warn('[GPS Scheduler Startup Cleanup Warning]:', err.message);
  });

  // Layer 1: Node-Cron on minute 0 and 30 in Asia/Kolkata timezone
  try {
    cronJob = cron.schedule(
      '0,30 * * * *',
      async () => {
        const slot = getCurrentIstSlotKey();
        if (lastSlotAttempted === slot) return;
        lastSlotAttempted = slot;
        await runScheduledGpsSync('CRON_WORKER_IST', slot);
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
      const settings = await GpsSetting.find({
        archived: { $ne: true },
        $or: [{ provider: /wheels.?eye/i }, { apiUrl: /wheelseye/i }],
      }).sort({ updatedAt: -1 });
      const setting = settings[0];
      const lastSync = setting?.last_evaluated_timestamp || setting?.lastSync || null;
      const elapsed = lastSync ? now.getTime() - new Date(lastSync).getTime() : Infinity;
      const slotMissed = lastSlotAttempted !== currentSlot && elapsed > 30 * 60 * 1000;

      if (slotMissed) {
        console.log(`[GPS Scheduler Heartbeat] Missed WheelsEye sync or boundary detected (Slot: ${currentSlot}). Catching up...`);
        lastSlotAttempted = currentSlot;
        await runScheduledGpsSync('AUTONOMOUS_HEARTBEAT_IST', currentSlot);
      }
    } catch (heartbeatErr) {
      console.warn('[GPS Scheduler Heartbeat Warning]:', heartbeatErr.message);
    }
  }, 15 * 1000);

  isSchedulerRunning = true;

  // Layer 3: Initial Startup Sync Check on server restart (Requirement 17)
  (async () => {
    try {
      const settings = await GpsSetting.find({
        archived: { $ne: true },
        $or: [{ provider: /wheels.?eye/i }, { apiUrl: /wheelseye/i }],
      }).sort({ updatedAt: -1 });
      const setting = settings[0];
      const lastSync = setting?.last_evaluated_timestamp || setting?.lastSync || null;
      const elapsedMs = lastSync ? Date.now() - new Date(lastSync).getTime() : Infinity;

      if (elapsedMs > 25 * 60 * 1000) {
        console.log(`[GPS Scheduler] Startup check: Telemetry data missing or >25m old. Executing initial sync...`);
        const slot = getCurrentIstSlotKey();
        lastSlotAttempted = slot;
        await runScheduledGpsSync('STARTUP_SYNC', slot);
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
  isSchedulerRunning = false;
  console.log('[GPS Scheduler] Stopped.');
}

function isGpsSchedulerRunning() {
  return isSchedulerRunning;
}

module.exports = {
  startGpsScheduler,
  stopGpsScheduler,
  runScheduledGpsSync,
  getCurrentIstSlotKey,
  getNextFixed30MinSlotIST,
  isGpsSchedulerRunning,
};
