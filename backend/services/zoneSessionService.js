const ZoneSession = require('../models/ZoneSession');
const { normalizeVehicleNumber } = require('./gpsTimelineService');

function getZoneId(plantName, plantId = null) {
  const name = String(plantName || '').toLowerCase();
  if (name.includes('dasna')) return 'DASNA';
  if (name.includes('salt')) return 'SALT';
  if (name.includes('tea')) return 'TEA';
  if (!name) return 'OUTSIDE';
  return plantId ? `PLANT_${plantId.toString()}` : `PLANT_${name.replace(/[^a-z0-9]+/g, '_')}`;
}

function applyFixToOpenSession(openSession, fix) {
  const normalizedNumber = normalizeVehicleNumber(fix.vehicleNumber);
  const gpsTime = new Date(fix.gpsTimestamp);
  if (Number.isNaN(gpsTime.getTime())) {
    throw new Error('A valid provider GPS timestamp is required for zone sessions.');
  }
  const parsedSyncTime = fix.syncTime ? new Date(fix.syncTime) : gpsTime;
  const syncTime = Number.isNaN(parsedSyncTime.getTime()) ? gpsTime : parsedSyncTime;
  const parsedTransitionTime = fix.providerTransitionTimestamp
    ? new Date(fix.providerTransitionTimestamp)
    : null;
  const providerTransitionTimestamp = parsedTransitionTime && !Number.isNaN(parsedTransitionTime.getTime())
    ? parsedTransitionTime
    : null;
  if (openSession && gpsTime <= new Date(openSession.lastSeenAt)) {
    return { action: 'unchanged', session: openSession };
  }
  if (openSession && openSession.zoneId === fix.zoneId) {
    return {
      action: 'update',
      session: {
        ...openSession,
        lastSeenAt: gpsTime,
        provider: fix.provider,
        syncId: fix.syncId || openSession.syncId || '',
        syncType: fix.syncType || openSession.syncType || 'AUTO',
      },
    };
  }
  return {
    action: openSession ? 'transition' : 'open',
    closeAt: openSession ? gpsTime : null,
    exitDetectedAt: openSession ? syncTime : null,
    providerExitTransitionTimestamp: openSession ? providerTransitionTimestamp : null,
    session: {
      vehicleId: fix.vehicleId,
      vehicleNumber: fix.vehicleNumber,
      vehicleNumberNormalized: normalizedNumber,
      zoneId: fix.zoneId,
      plantId: fix.plantId || null,
      enteredAt: gpsTime,
      entryGpsTimestamp: gpsTime,
      detectedAt: syncTime,
      providerTransitionTimestamp,
      lastSeenAt: gpsTime,
      exitedAt: null,
      provider: fix.provider,
      syncId: fix.syncId || '',
      syncType: fix.syncType || 'AUTO',
    },
  };
}

function seedSessionFromCurrentStatus(fix, currentStatus) {
  if (!currentStatus?.latest_gps_timestamp || !/wheels.?eye/i.test(currentStatus.provider || '')) {
    return null;
  }
  const previousZone = currentStatus.status === 'Inside'
    ? (currentStatus.current_plant
        ? getZoneId(currentStatus.current_plant, currentStatus.currentPlantId)
        : null)
    : currentStatus.status === 'Outside'
      ? 'OUTSIDE'
      : null;
  if (!previousZone) return null;

  const lastSeenAt = new Date(currentStatus.latest_gps_timestamp);
  if (Number.isNaN(lastSeenAt.getTime())) return null;
  const previousEntry = previousZone === 'OUTSIDE'
    ? currentStatus.lastExitDateTime || currentStatus.latest_gps_timestamp
    : currentStatus.lastEntryGpsTimestamp || currentStatus.lastEntryDateTime || currentStatus.latest_gps_timestamp;
  const parsedEntry = new Date(previousEntry);
  const enteredAt = Number.isNaN(parsedEntry.getTime()) || parsedEntry > lastSeenAt
    ? lastSeenAt
    : parsedEntry;
  const previousDetection = previousZone === 'OUTSIDE'
    ? currentStatus.lastExitDetectedAt
    : currentStatus.lastEntryDetectedAt;
  const parsedDetection = previousDetection ? new Date(previousDetection) : enteredAt;
  const syncType = ['AUTO', 'MANUAL'].includes(currentStatus.lastSyncType)
    ? currentStatus.lastSyncType
    : undefined;

  return {
    vehicleId: currentStatus.vehicleId || fix.vehicleId,
    vehicleNumber: fix.vehicleNumber,
    vehicleNumberNormalized: normalizeVehicleNumber(fix.vehicleNumber),
    zoneId: previousZone,
    plantId: previousZone === 'OUTSIDE' ? null : currentStatus.currentPlantId || null,
    enteredAt,
    entryGpsTimestamp: enteredAt,
    detectedAt: Number.isNaN(parsedDetection.getTime()) || parsedDetection > lastSeenAt
      ? enteredAt
      : parsedDetection,
    lastSeenAt,
    exitedAt: null,
    provider: currentStatus.provider,
    syncId: currentStatus.lastSyncId || '',
    ...(syncType ? { syncType } : {}),
  };
}

async function reconcileZoneSession(fix, currentStatus = null) {
  const normalizedNumber = normalizeVehicleNumber(fix.vehicleNumber);
  let openSession = await ZoneSession.findOne({
    vehicleNumberNormalized: normalizedNumber,
    exitedAt: null,
    provider: fix.provider || 'WheelsEye GPS',
    archived: { $ne: true },
  }).sort({ enteredAt: -1 });
  if (!openSession) {
    const seed = seedSessionFromCurrentStatus(fix, currentStatus);
    if (seed) openSession = await ZoneSession.create(seed);
  }
  const previousSession = openSession;
  const change = applyFixToOpenSession(openSession?.toObject() || openSession, fix);

  if (change.action === 'unchanged') return { session: openSession, action: change.action, previousSession };
  if (change.action === 'update') {
    await ZoneSession.updateOne(
      { _id: openSession._id, lastSeenAt: openSession.lastSeenAt },
      {
        $set: {
          lastSeenAt: change.session.lastSeenAt,
          provider: change.session.provider,
          syncId: change.session.syncId,
          syncType: change.session.syncType,
        },
      }
    );
    return {
      session: await ZoneSession.findById(openSession._id),
      action: change.action,
      previousSession,
    };
  }

  if (openSession) {
    await ZoneSession.updateOne(
      { _id: openSession._id, exitedAt: null },
      {
        $set: {
          exitedAt: change.closeAt,
          exitGpsTimestamp: change.closeAt,
          exitDetectedAt: change.exitDetectedAt,
          providerExitTransitionTimestamp: change.providerExitTransitionTimestamp,
        },
      }
    );
  }
  return {
    session: await ZoneSession.create(change.session),
    action: change.action,
    previousSession,
  };
}

module.exports = {
  applyFixToOpenSession,
  getZoneId,
  seedSessionFromCurrentStatus,
  reconcileZoneSession,
};
