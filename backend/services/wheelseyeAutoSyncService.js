const {
  executeGpsSync,
  DEFAULT_WHEELSEYE_URL,
} = require('./gpsSyncService');

/**
 * Backward-compatible bridge to the unified GPS Sync Service.
 */
async function executeWheelseyeAutoSync(triggerType = 'CRON_WORKER_IST') {
  const isAuto =
    triggerType === 'CRON_WORKER_IST' ||
    triggerType === 'GPS_AUTO_SYNC_30MIN' ||
    triggerType === 'STARTUP_SYNC' ||
    triggerType.includes('Auto');

  return await executeGpsSync({
    source: isAuto ? 'AUTO' : 'MANUAL',
    triggerType,
  });
}

module.exports = {
  executeWheelseyeAutoSync,
  DEFAULT_WHEELSEYE_URL,
};
