function parseTelemetryNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTelemetryBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'off', 'no'].includes(normalized)) return false;
  }
  return null;
}

function normalizeVendorMovementStatus(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['moving', 'in motion', 'running', 'driving'].includes(normalized)) return 'Moving';
  if (['stopped', 'stop', 'idle', 'parked'].includes(normalized)) return 'Stopped';
  return null;
}

function resolveMovementStatus({ movementStatus, ignition, speed }) {
  if (movementStatus === 'Moving' || movementStatus === 'Stopped') return movementStatus;
  if (ignition !== true || typeof speed !== 'number' || speed <= 2) return 'Stopped';
  return 'Moving';
}

module.exports = {
  parseTelemetryNumber,
  parseTelemetryBoolean,
  normalizeVendorMovementStatus,
  resolveMovementStatus,
};
