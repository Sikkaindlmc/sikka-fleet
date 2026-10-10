const connectDB = require('../config/db');
const VehicleLocation = require('../models/VehicleLocation');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const Vehicle = require('../models/Vehicle');
const GpsSyncLock = require('../models/GpsSyncLock');

async function runMigration() {
  await connectDB();
  console.log('[Migration] Connected to database.');

  // 1. Initialize GpsSyncLock if not present
  await GpsSyncLock.findOneAndUpdate(
    { _id: 'gps_sync_lock' },
    { $setOnInsert: { isLocked: false, expiresAt: new Date(0) } },
    { upsert: true }
  );
  console.log('[Migration] GpsSyncLock initialized.');

  // 2. Find and remove duplicates in VehicleLocation
  console.log('[Migration] Scanning for duplicates in VehicleLocation...');
  const duplicates = await VehicleLocation.aggregate([
    {
      $group: {
        _id: { vehicleId: '$vehicleId', gpsDateTime: '$gpsDateTime' },
        docs: { $push: '$_id' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  let removedCount = 0;
  for (const group of duplicates) {
    // Keep first doc, delete the rest
    const [keepId, ...deleteIds] = group.docs;
    const res = await VehicleLocation.deleteMany({ _id: { $in: deleteIds } });
    removedCount += res.deletedCount;
  }
  console.log(`[Migration] Cleaned up ${removedCount} duplicate VehicleLocation records across ${duplicates.length} duplicate groups.`);

  // 3. Ensure unique index on vehicleId + gpsDateTime
  try {
    await VehicleLocation.collection.createIndex(
      { vehicleId: 1, gpsDateTime: 1 },
      { unique: true, background: true }
    );
    console.log('[Migration] Unique compound index created on vehicleLocations: { vehicleId: 1, gpsDateTime: 1 }.');
  } catch (idxErr) {
    console.warn('[Migration Index Warning]:', idxErr.message);
  }

  // 4. Backfill VehicleCurrentStatus vehicleNumber
  const statuses = await VehicleCurrentStatus.find().populate('vehicleId', 'vehicleNumber');
  let backfilledStatuses = 0;
  for (const st of statuses) {
    if (st.vehicleId && st.vehicleId.vehicleNumber) {
      st.vehicleNumber = st.vehicleId.vehicleNumber;
      st.current_geofence = st.status === 'Inside' ? 'INSIDE' : 'OUTSIDE';
      if (!st.gps_status) st.gps_status = 'LIVE';
      if (!st.last_sync_source) st.last_sync_source = 'AUTO';
      if (!st.latest_gps_timestamp) st.latest_gps_timestamp = st.lastUpdatedAt;
      if (!st.last_successful_sync_at) st.last_successful_sync_at = st.lastUpdatedAt;
      await st.save();
      backfilledStatuses++;
    }
  }
  console.log(`[Migration] Backfilled ${backfilledStatuses} VehicleCurrentStatus records.`);

  console.log('[Migration] Database migration completed successfully.');
  process.exit(0);
}

runMigration().catch((err) => {
  console.error('[Migration Error]:', err);
  process.exit(1);
});
