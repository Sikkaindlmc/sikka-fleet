require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Vehicle = require('../models/Vehicle');
const GpsSyncLog = require('../models/GpsSyncLog');
const VehicleLocation = require('../models/VehicleLocation');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const PlantEntry = require('../models/PlantEntry');
const PlantStay = require('../models/PlantStay');
const GpsHistory = require('../models/GpsHistory');
const { normalizeVehicleNumber } = require('../services/gpsTimelineService');
const { rebuildPlantStays } = require('../services/gpsDataService');

const execute = process.argv.includes('--execute');
const isRealProvider = (value) => /wheels.?eye|fleetx/i.test(String(value || ''));
const isManualOrFixture = (record) =>
  /manual|simulat|fixture|dummy|mock/i.test(
    `${record.sync_source || ''} ${record.provider || ''} ${record.source || ''}`
  );

function isReportableLocation(location) {
  return Boolean(
    isRealProvider(location.provider || location.source) &&
    location.gpsDateTime &&
    Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude) &&
    !(location.latitude === 0 && location.longitude === 0)
  );
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI must be set in backend/.env.');
  await mongoose.connect(mongoUri, {
    dbName: process.env.MONGODB_DB_NAME || undefined,
  });

  const [vehicles, legacyLocations, entries, statuses, manualSyncLogs, stayCount] = await Promise.all([
    Vehicle.find().select('_id vehicleNumber'),
    VehicleLocation.find(),
    PlantEntry.find(),
    VehicleCurrentStatus.find({ last_sync_source: 'MANUAL' }).select('_id vehicleNumber current_plant lastEntryDateTime'),
    GpsSyncLog.find({ source: 'MANUAL' }).select('_id syncId startedAt triggerType'),
    PlantStay.countDocuments(),
  ]);
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle._id.toString(), vehicle]));
  const legacyDelete = legacyLocations.filter((location) =>
    isManualOrFixture(location) || !isReportableLocation(location)
  );
  const legacyKeep = legacyLocations.filter((location) => !legacyDelete.includes(location));
  const reportableLegacyLocations = legacyKeep.filter(isReportableLocation);

  const deleteEntries = entries.map((entry) => ({
    entry,
    reason: 'Legacy PlantEntry is replaced by stays rebuilt only from GPS history',
  }));

  console.log(`GPS cleanup preview (${execute ? 'EXECUTE' : 'DRY RUN'}; no action unless --execute is present)`);
  console.log(`Manual/fixture/unverifiable VehicleLocation records to delete: ${legacyDelete.length}`);
  for (const item of legacyDelete) {
    console.log(`  VehicleLocation ${item._id} | ${item.vehicleNumber} | ${item.gpsDateTime?.toISOString() || 'no GPS timestamp'} | ${item.provider || item.source} | ${item.sync_source || 'no sync source'}`);
  }
  console.log(`Legacy PlantEntry records to delete and rebuild from GPS history: ${deleteEntries.length}`);
  for (const { entry, reason } of deleteEntries) {
    console.log(`  PlantEntry ${entry._id} | ${entry.vehicleNumber} | ${entry.plantName} | ${entry.entryDateTime?.toISOString() || 'no entry timestamp'} | ${reason}`);
  }
  console.log(`GPS sync logs with MANUAL source to delete: ${manualSyncLogs.length}`);
  for (const log of manualSyncLogs) {
    console.log(`  GpsSyncLog ${log._id} | ${log.syncId} | ${log.startedAt?.toISOString() || 'no start time'} | ${log.triggerType}`);
  }
  console.log(`PlantStay records to rebuild from GPS history: ${stayCount}`);
  console.log(`Manual current-status records to clear: ${statuses.length}`);
  for (const status of statuses) {
    console.log(`  VehicleCurrentStatus ${status._id} | ${status.vehicleNumber} | ${status.current_plant || 'no plant'} | ${status.lastEntryDateTime || 'no entry time'}`);
  }

  if (!execute) {
    console.log('Preview only. Review the listed records, then rerun with --execute to apply this cleanup.');
    return;
  }

  for (const location of reportableLegacyLocations) {
    const vehicle = vehicleById.get(location.vehicleId.toString());
    if (!vehicle) continue;
    const provider = location.provider || location.source;
    await GpsHistory.updateOne(
      {
        vehicleNumberNormalized: normalizeVehicleNumber(vehicle.vehicleNumber),
        provider,
        gpsTimestamp: location.gpsDateTime,
      },
      {
        $setOnInsert: {
          vehicleId: vehicle._id,
          vehicleNumber: vehicle.vehicleNumber,
          vehicleNumberNormalized: normalizeVehicleNumber(vehicle.vehicleNumber),
          provider,
          latitude: location.latitude,
          longitude: location.longitude,
          speed: location.speedRaw ?? location.rawTelemetry?.speed ?? location.speed ?? null,
          ignition: location.ignitionRaw ?? location.rawTelemetry?.ignition ?? location.ignition ?? null,
          gpsTimestamp: location.gpsDateTime,
          syncTime: location.receivedAt || location.createdAt || location.gpsDateTime,
          rawTelemetry: location.rawTelemetry,
        },
      },
      { upsert: true }
    );
  }

  if (legacyDelete.length) {
    await VehicleLocation.deleteMany({ _id: { $in: legacyDelete.map((item) => item._id) } });
  }
  if (deleteEntries.length) {
    await PlantEntry.deleteMany({ _id: { $in: deleteEntries.map(({ entry }) => entry._id) } });
  }
  if (statuses.length) {
    await VehicleCurrentStatus.updateMany(
      { _id: { $in: statuses.map((item) => item._id) } },
      {
        $set: { status: 'Outside', current_geofence: 'UNKNOWN', gps_status: 'GPS DATA UNAVAILABLE' },
        $unset: {
          currentPlantId: 1,
          current_plant: 1,
          lastEntryDateTime: 1,
          lastExitPlantName: 1,
          lastExitDateTime: 1,
        },
      }
    );
  }
  if (manualSyncLogs.length) {
    await GpsSyncLog.deleteMany({ _id: { $in: manualSyncLogs.map((log) => log._id) } });
  }

  await PlantStay.deleteMany({});
  for (const vehicle of vehicles) await rebuildPlantStays(vehicle._id);
  console.log('Cleanup applied. No GPS positions were fabricated or fetched by this script.');
}

main()
  .catch((error) => {
    console.error('[GPS cleanup failed]', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
