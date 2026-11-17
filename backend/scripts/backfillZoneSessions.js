const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config();
const connectDB = require('../config/db');
const Plant = require('../models/Plant');
const Vehicle = require('../models/Vehicle');
const GpsHistory = require('../models/GpsHistory');
const ZoneSession = require('../models/ZoneSession');
const { uniqueChronologicalSamples, normalizeVehicleNumber } = require('../services/gpsTimelineService');
const { isVerifiedGpsSample } = require('../services/geofenceService');

async function backfillZoneSessions() {
  await connectDB();
  await ZoneSession.init();
  const [vehicles, plants] = await Promise.all([
    Vehicle.find().select('_id vehicleNumber'),
    Plant.find({ status: 'Active' }),
  ]);
  let createdSessions = 0;
  for (const vehicle of vehicles) {
    if (await ZoneSession.exists({
      vehicleId: vehicle._id,
      provider: /wheels.?eye/i,
      archived: { $ne: true },
    })) continue;
    const history = await GpsHistory.find({
      vehicleId: vehicle._id,
      provider: /wheels.?eye/i,
      archived: { $ne: true },
    }).sort({ gpsTimestamp: 1, syncTime: 1 });
    const samples = history.filter(isVerifiedGpsSample);
    const points = uniqueChronologicalSamples(samples, plants);
    if (points.length === 0) continue;

    const sampleByTime = new Map();
    for (const sample of samples) {
      sampleByTime.set(new Date(sample.gpsTimestamp).getTime(), sample);
    }
    const sessions = [];
    let current = null;
    for (const point of points) {
      const sample = sampleByTime.get(point.time.getTime());
      const zoneId = point.status === 'DASNA'
        ? 'DASNA'
        : point.status === 'Salt Plant'
          ? 'SALT'
          : point.status === 'Tea Plant'
            ? 'TEA'
            : 'OUTSIDE';
      if (current && current.zoneId === zoneId) {
        current.lastSeenAt = point.time;
        current.syncId = sample?.syncId || current.syncId || '';
        current.syncType = sample?.syncType || current.syncType;
        continue;
      }
      if (current) {
        current.exitedAt = point.time;
        current.exitGpsTimestamp = point.time;
        current.exitDetectedAt = sample?.syncTime || point.time;
        current.providerExitTransitionTimestamp = sample?.providerTransitionTimestamp || null;
        sessions.push(current);
      }
      current = {
        vehicleId: vehicle._id,
        vehicleNumber: vehicle.vehicleNumber,
        vehicleNumberNormalized: normalizeVehicleNumber(vehicle.vehicleNumber),
        zoneId,
        plantId: null,
        enteredAt: point.time,
        entryGpsTimestamp: point.time,
        detectedAt: sample?.syncTime || point.time,
        providerTransitionTimestamp: sample?.providerTransitionTimestamp || null,
        lastSeenAt: point.time,
        exitedAt: null,
        provider: sample?.provider || 'GPS history',
        syncId: sample?.syncId || '',
        syncType: sample?.syncType,
      };
    }
    if (current) sessions.push(current);
    if (sessions.length) {
      await ZoneSession.insertMany(sessions, { ordered: true });
      createdSessions += sessions.length;
    }
  }
  console.log(`Created ${createdSessions} zone session(s) from existing GPS history.`);
}

backfillZoneSessions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Zone session migration failed: ${error.message}`);
    process.exit(1);
  });
