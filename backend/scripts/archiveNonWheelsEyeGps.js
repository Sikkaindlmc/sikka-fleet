require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
mongoose.set('autoIndex', false);
const GpsHistory = require('../models/GpsHistory');
const VehicleLocation = require('../models/VehicleLocation');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const ZoneSession = require('../models/ZoneSession');
const GpsSyncLog = require('../models/GpsSyncLog');
const CronExecutionLog = require('../models/CronExecutionLog');
const GpsSetting = require('../models/GpsSetting');

const applyChanges = process.argv.includes('--apply');
const collections = [
  GpsHistory,
  VehicleLocation,
  VehicleCurrentStatus,
  ZoneSession,
  GpsSyncLog,
  CronExecutionLog,
  GpsSetting,
].map((model) => model.collection.name);
const legacyGpsQuery = {
  archived: { $ne: true },
  $and: [
    { $nor: [{ provider: /wheels.?eye/i }, { source: /wheels.?eye/i }] },
    { $or: [{ provider: { $type: 'string' } }, { source: { $type: 'string' } }] },
  ],
};

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI must be set in backend/.env.');
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME || undefined });

  try {
    console.log(`Historical GPS archive ${applyChanges ? 'apply' : 'dry run'}; no records will be deleted.`);
    for (const name of collections) {
      const collection = mongoose.connection.db.collection(name);
      const count = await collection.countDocuments(legacyGpsQuery);
      console.log(`${name}: ${count} record(s) ${applyChanges ? 'to archive' : 'would be archived'}.`);
      if (applyChanges && count > 0) {
        const result = await collection.updateMany(legacyGpsQuery, {
          $set: { archived: true },
        });
        console.log(`${name}: archived ${result.modifiedCount} record(s).`);
      }
      if (applyChanges) {
        await collection.updateMany(
          {
            archived: { $ne: false },
            $or: [{ provider: /wheels.?eye/i }, { source: /wheels.?eye/i }],
          },
          { $set: { archived: false } }
        );
      }
    }

    const statusModel = VehicleCurrentStatus;
    const statusCollection = statusModel.collection;
    const indexes = await statusCollection.indexes();
    const legacyUniqueStatusIndexes = indexes.filter((index) =>
      index.unique && index.name !== 'one_active_gps_status_per_vehicle' &&
      index.key?.vehicleId === 1 && Object.keys(index.key).length === 1
    );
    console.log(`Vehicle status unique-index migration: ${legacyUniqueStatusIndexes.length} legacy index(es) would be replaced with an active-record partial unique index.`);
    if (applyChanges) {
      await statusCollection.updateMany(
        { provider: /wheels.?eye/i, archived: { $ne: false } },
        { $set: { archived: false } }
      );
      for (const index of legacyUniqueStatusIndexes) {
        await statusCollection.dropIndex(index.name);
      }
      await statusCollection.createIndex(
        { vehicleId: 1 },
        {
          unique: true,
          name: 'one_active_gps_status_per_vehicle',
          partialFilterExpression: { archived: false },
        }
      );
      console.log('Vehicle status indexes migrated; GPS data records were preserved.');
    }

    const zoneCollection = ZoneSession.collection;
    const zoneIndexes = await zoneCollection.indexes();
    const legacyUniqueZoneIndexes = zoneIndexes.filter((index) =>
      index.unique && index.key?.vehicleId === 1 && Object.keys(index.key).length === 1
    );
    console.log(`Zone-session unique-index migration: ${legacyUniqueZoneIndexes.length} legacy index(es) would be replaced with a normalized-number partial unique index.`);
    if (applyChanges) {
      for (const index of legacyUniqueZoneIndexes) {
        await zoneCollection.dropIndex(index.name);
      }
      await zoneCollection.createIndex(
        { vehicleNumberNormalized: 1 },
        {
          unique: true,
          name: 'one_open_zone_session_per_vehicle_number',
          partialFilterExpression: { exitedAt: null, archived: false },
        }
      );
      console.log('Zone-session indexes migrated; existing sessions were preserved.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(`[GPS archive error] ${error.message}`);
  process.exitCode = 1;
});
