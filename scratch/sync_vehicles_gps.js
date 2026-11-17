require('dotenv').config({ path: require('path').resolve(__dirname, '../backend/.env') });
const mongoose = require('mongoose');
const connectDB = require('../backend/config/db');
const { executeGpsSync } = require('../backend/services/gpsSyncService');

async function run() {
  if (!process.argv.includes('--execute') || process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run a database sync script. Use --execute outside production only.');
  }

  try {
    await connectDB();
    const result = await executeGpsSync({
      source: 'GPS-AUTO',
      triggerType: 'SCRIPT_SYNC',
    });
    console.log('[GPS Sync Script] Completed through the WheelsEye sync path.', result);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error('[GPS Sync Script Error]:', error.message);
  process.exitCode = 1;
});
