const DEFAULT_CONFIRMATION_MAX_GAP_MS =
  Number(process.env.GPS_GEOFENCE_CONFIRMATION_MAX_GAP_MINUTES || 90) * 60 * 1000;

function normalizeStatus(status) {
  const value = String(status || '').toUpperCase();
  return ['INSIDE', 'OUTSIDE'].includes(value) ? value : 'UNKNOWN';
}

function normalizePlantId(plantId) {
  return plantId ? String(plantId) : null;
}

function sameZone(leftStatus, leftPlantId, rightStatus, rightPlantId) {
  return leftStatus === rightStatus &&
    (leftStatus !== 'INSIDE' || normalizePlantId(leftPlantId) === normalizePlantId(rightPlantId));
}

function evaluateGeofenceConfirmation({
  currentStatus,
  previousFix,
  candidateStatus,
  candidatePlantId,
  gpsTimestamp,
  maxGapMs = DEFAULT_CONFIRMATION_MAX_GAP_MS,
}) {
  const candidate = normalizeStatus(candidateStatus);
  const timestamp = new Date(gpsTimestamp);
  const currentDate = Number.isNaN(timestamp.getTime()) ? null : timestamp;
  const statusValue = normalizeStatus(currentStatus?.current_geofence || currentStatus?.status);
  const statusPlantId = currentStatus?.currentPlantId || currentStatus?.plantId || null;

  if (!currentDate || candidate === 'UNKNOWN') {
    return {
      status: statusValue,
      plantId: statusValue === 'INSIDE' ? statusPlantId : null,
      confirmed: false,
      transition: null,
      transitionGpsTimestamp: null,
    };
  }

  if (sameZone(statusValue, statusPlantId, candidate, candidatePlantId)) {
    return {
      status: candidate,
      plantId: candidate === 'INSIDE' ? candidatePlantId : null,
      confirmed: true,
      transition: null,
      transitionGpsTimestamp: null,
    };
  }

  const previousTimestamp = previousFix?.gpsTimestamp ? new Date(previousFix.gpsTimestamp) : null;
  const previousCandidate = normalizeStatus(
    previousFix?.candidateGeofenceStatus || previousFix?.geofence_status
  );
  const previousCandidatePlantId = previousFix?.candidatePlantId || previousFix?.plantId || null;
  const gap = previousTimestamp ? currentDate.getTime() - previousTimestamp.getTime() : NaN;
  const hasConsecutiveCandidate = previousFix?.statusEligible !== false &&
    Number.isFinite(gap) &&
    gap > 0 &&
    gap <= maxGapMs &&
    sameZone(previousCandidate, previousCandidatePlantId, candidate, candidatePlantId);

  if (!hasConsecutiveCandidate) {
    const previousConfirmedStatus = normalizeStatus(previousFix?.geofence_status);
    const fallbackStatus = statusValue === 'UNKNOWN' ? previousConfirmedStatus : statusValue;
    const fallbackPlantId = statusValue === 'UNKNOWN'
      ? previousFix?.plantId || null
      : statusPlantId;
    return {
      status: fallbackStatus,
      plantId: fallbackStatus === 'INSIDE' ? fallbackPlantId : null,
      confirmed: false,
      transition: null,
      transitionGpsTimestamp: null,
    };
  }

  const baselineStatus = statusValue === 'UNKNOWN'
    ? normalizeStatus(previousFix?.geofence_status)
    : statusValue;
  const baselinePlantId = statusValue === 'UNKNOWN'
    ? previousFix?.plantId || null
    : statusPlantId;
  const transition = candidate === 'INSIDE'
    ? baselineStatus === 'INSIDE' ? 'PLANT_CHANGE' : 'ENTRY'
    : baselineStatus === 'INSIDE' ? 'EXIT' : null;

  return {
    status: candidate,
    plantId: candidate === 'INSIDE' ? candidatePlantId : null,
    confirmed: true,
    transition,
    transitionGpsTimestamp: transition ? previousTimestamp : null,
  };
}

module.exports = {
  DEFAULT_CONFIRMATION_MAX_GAP_MS,
  evaluateGeofenceConfirmation,
};
