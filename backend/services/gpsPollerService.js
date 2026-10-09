const GpsSetting = require('../models/GpsSetting');
const Vehicle = require('../models/Vehicle');
const { executeWheelseyeAutoSync } = require('./wheelseyeAutoSyncService');
const { fetchGpsLocations } = require('./gpsSimulatorService');
const { processVehicleLocation } = require('./geofenceService');

let pollerIntervalId = null;

async function syncGpsPositions(syncType = 'Auto Sync') {
  return await executeWheelseyeAutoSync(syncType);
}

async function testGpsConnection() {
  try {
    const config = await GpsSetting.findOne().sort({ updatedAt: -1 });
    if (!config) {
      return {
        status: 'Connected',
        message: 'Built-in telematics simulator ready and active.',
        lastSync: new Date(),
      };
    }

    // Test fetching locations
    const points = await fetchGpsLocations(config);
    config.connectionStatus = 'Connected';
    config.lastSync = new Date();
    config.lastError = '';
    await config.save();

    return {
      status: 'Connected',
      message: `Successfully connected to ${config.provider}. Verified ${points.length} telemetry streams.`,
      lastSync: config.lastSync,
    };
  } catch (error) {
    const config = await GpsSetting.findOne().sort({ updatedAt: -1 });
    if (config) {
      config.connectionStatus = 'Connection Failed';
      config.lastError = error.message;
      await config.save();
    }
    return {
      status: 'Connection Failed',
      message: error.message || 'Unable to connect to GPS provider.',
      lastError: error.message,
    };
  }
}

function startGpsPoller(intervalSeconds = 1800) {
  if (pollerIntervalId) {
    clearInterval(pollerIntervalId);
  }

  console.log(`[GPS Poller] Auto sync GPS active every 30 Min mandatory (${intervalSeconds}s / ${Math.round(intervalSeconds / 60)} minutes)`);
  syncGpsPositions('Auto Sync (Startup)').catch((err) => console.error('[Initial GPS Sync Error]:', err.message));

  pollerIntervalId = setInterval(() => {
    syncGpsPositions('Auto Sync (30 Min Poller)').catch((err) => console.error('[GPS Sync Error]:', err.message));
  }, intervalSeconds * 1000);
}

function stopGpsPoller() {
  if (pollerIntervalId) {
    clearInterval(pollerIntervalId);
    pollerIntervalId = null;
  }
}

module.exports = {
  syncGpsPositions,
  testGpsConnection,
  startGpsPoller,
  stopGpsPoller,
};
