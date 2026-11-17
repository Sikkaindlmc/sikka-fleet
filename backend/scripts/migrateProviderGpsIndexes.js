require('dotenv').config();
const mongoose = require('mongoose');
const ZoneSession = require('../models/ZoneSession');

async function migrateProviderGpsIndexes() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required to migrate GPS provider indexes.');

  await mongoose.connect(uri);
  const collection = mongoose.connection.collection('zone_sessions');
  const indexes = await collection.indexes();
  const legacyIndex = indexes.find((index) => index.name === 'one_open_zone_session_per_vehicle_number');
  if (legacyIndex) await collection.dropIndex(legacyIndex.name);
  await ZoneSession.createIndexes();
}

migrateProviderGpsIndexes()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error('[GPS provider index migration failed]:', error.message);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
