const GpsSetting = require('../models/GpsSetting');
const { executeGpsSync, DEFAULT_WHEELSEYE_URL } = require('./gpsSyncService');
const axios = require('axios');

async function syncGpsPositions(syncType = 'Auto Sync') {
  const isAuto = syncType.toLowerCase().includes('auto') || syncType.toLowerCase().includes('cron');
  return await executeGpsSync({
    source: isAuto ? 'AUTO' : 'MANUAL',
    triggerType: syncType,
  });
}

async function testGpsConnection() {
  try {
    const config = await GpsSetting.findOne().sort({ updatedAt: -1 });
    const apiUrl = config?.apiUrl && config.apiUrl.includes('wheelseye') ? config.apiUrl : DEFAULT_WHEELSEYE_URL;

    const res = await axios.get(apiUrl, { timeout: 10000 });
    let count = 0;
    if (res.data?.data?.list) count = res.data.data.list.length;
    else if (res.data?.list) count = res.data.list.length;
    else if (Array.isArray(res.data)) count = res.data.length;

    if (config) {
      config.connectionStatus = 'Connected';
      config.lastSync = new Date();
      config.lastError = '';
      await config.save();
    }

    return {
      status: 'Connected',
      message: `Successfully connected to WheelsEye GPS. Received telemetry for ${count} vehicles.`,
      lastSync: new Date(),
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

function startGpsPoller() {
  // Handled by gpsScheduler
}

function stopGpsPoller() {
  // Handled by gpsScheduler
}

module.exports = {
  syncGpsPositions,
  testGpsConnection,
  startGpsPoller,
  stopGpsPoller,
};
