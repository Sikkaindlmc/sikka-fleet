require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { executeGpsSync } = require('../services/gpsSyncService');

async function syncGpsProviders() {
  if (!process.argv.includes('--execute') || process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run a database sync script. Use --execute outside production only.');
  }

  try {
    await connectDB();
    const result = await executeGpsSync({
      source: 'GPS-AUTO',
      triggerType: 'SCRIPT_SYNC',
    });
    console.log('[GPS Sync Script] Completed using the WheelsEye sync path.', result);
  } finally {
    await mongoose.disconnect();
  }
}

syncGpsProviders().catch((error) => {
  console.error('[GPS Sync Script Error]:', error.message);
  process.exitCode = 1;
});
