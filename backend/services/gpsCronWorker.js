const {
  startGpsScheduler,
  stopGpsScheduler,
  getNextFixed30MinSlotIST,
} = require('./gpsScheduler');
const { getAutoSyncStatus } = require('./gpsSyncService');

function startGpsCronWorker() {
  startGpsScheduler();
}

function stopGpsCronWorker() {
  stopGpsScheduler();
}

async function getCronWorkerStatus() {
  const status = await getAutoSyncStatus();
  return {
    isRunning: true,
    schedule: '0,30 * * * * (Asia/Kolkata)',
    intervalMinutes: 30,
    lastRunTime: status.last_sync_started_at,
    lastEvaluatedTimestamp: status.last_successful_sync_at,
    nextSyncTimestamp: status.next_scheduled_sync_at,
    status: status.last_sync_status,
    lastError: status.last_error,
    connectionStatus: status.connection_status,
    provider: status.provider,
  };
}

module.exports = {
  startGpsCronWorker,
  stopGpsCronWorker,
  getCronWorkerStatus,
  getNextFixed30MinSlot: getNextFixed30MinSlotIST,
};
