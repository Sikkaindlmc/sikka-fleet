const { createHash } = require('crypto');
const Vehicle = require('../models/Vehicle');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const GpsHistory = require('../models/GpsHistory');
const Plant = require('../models/Plant');
const { GPS_STALE_THRESHOLD_MS } = require('../config/gps');
const { getVehiclePlantStatus } = require('./geofenceService');
const { getReadableLocation, isReadableProviderAddress } = require('./locationHelper');
const { normalizeVehicleNumber } = require('./gpsTimelineService');
const { normalizeGpsProvider } = require('../utils/gpsProvider');

const UNSUPPORTED_MESSAGE = 'I can only sync GPS and show vehicle locations.';
const NOT_REGISTERED_MESSAGE = 'This vehicle is not registered in Sikka Fleet.';
const UNAVAILABLE_MESSAGE = 'Required GPS information is not available in Sikka Fleet.';
const EXACT_VEHICLE_MESSAGE = 'Please include the exact registered vehicle number.';
const ALLOWED_AI_ACTIONS = Object.freeze(['sync_gps', 'get_vehicle_location']);
const SAFE_SYNC_ERROR_CODES = new Set([
  'LOGIN_FAILED',
  'NO_VEHICLES',
  'VEHICLE_NOT_MATCHED',
  'INVALID_COORDINATES',
  'GPS_TIMESTAMP_MISSING',
  'FUTURE_GPS_TIMESTAMP',
  'REQUEST_TIMEOUT',
  'REQUEST_FAILED',
  'SYNC_FAILED',
]);
const TIME_ZONE = 'Asia/Kolkata';

function hashQuery(query) {
  return createHash('sha256').update(String(query)).digest('hex');
}

function sanitizeDisplayText(value, maxLength = 160) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function formatIstTimestamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return 'record not available';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function getLanguage(question) {
  return /[\u0900-\u097f]/.test(question) ? 'hi' : 'en';
}

function extractVehicleToken(question) {
  const input = String(question || '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/g, ' ');
  const registration = input.match(/\b([a-z]{2}[\s-]*\d{2}[\s-]*[a-z]{1,3}[\s-]*\d{1,4})\b/i);
  if (registration) return normalizeVehicleNumber(registration[1]);
  return input.match(/\b\d{4,6}\b/)?.[0] || null;
}

function extractProvider(question) {
  if (/\bfleet[\s-]?x\b/i.test(question)) return 'FLEETX';
  if (/\bwheels[\s-]?eye\b/i.test(question)) return 'WHEELSEYE';
  return null;
}

function recognizeQuestion(question) {
  const language = getLanguage(question);
  const explicitChangeRequest = /\b(?:create|add|edit|modify|change|delete|remove|import|assign|set|configure|reset|deactivate|activate)\b/i
    .test(question) ||
    /\b(?:update|modify)\b.*\b(?:vehicle|driver|plant|user|role|report|settings?|credentials?)\b/i
      .test(question) ||
    /जोड़|बनाओ|बदल|हटाओ|मिटाओ|संपादित|कॉन्फ़िगर/i.test(question);
  if (explicitChangeRequest) return { tool: 'unsupported', args: {}, language };

  const asksForSyncStatus = /\b(?:sync|connection|provider)\b.*\b(?:status|health|last|next)\b/i
    .test(question) ||
    /\b(?:status|health)\b.*\b(?:sync|connection|provider)\b/i.test(question);
  const provider = extractProvider(question);
  const syncVerb = /\b(?:sync|synchroni[sz]e|refresh|fetch)\b/i.test(question) ||
    /\bupdate\b.*\b(?:gps|wheelseye|fleetx)\b/i.test(question);
  const syncTarget = /\b(?:gps|wheelseye|fleetx|providers?|fleet|vehicles?)\b/i.test(question);
  if (syncVerb && syncTarget && !asksForSyncStatus) {
    return { tool: 'sync_gps', args: { provider }, language };
  }
  if (asksForSyncStatus) return { tool: 'unsupported', args: {}, language };

  const disallowedQuery = /\b(?:yesterday|history|historical|route|trail|previous|past|was|were|report|trip|plan|driver|availability|movement|stoppage|count|list|registered vehicles|how many)\b/i
    .test(question);
  if (disallowedQuery) return { tool: 'unsupported', args: {}, language };

  const vehicleNumber = extractVehicleToken(question);
  const locationRequest = /\b(?:where|location|position|currently|current|now|latest|locate|find|kahan|kidhar|abhi)\b|कहाँ|कहां|जगह|लोकेशन/i
    .test(question);
  if (locationRequest || (vehicleNumber && /\bgps\b/i.test(question))) {
    return { tool: 'get_vehicle_location', args: { vehicleNumber }, language };
  }
  return { tool: 'unsupported', args: {}, language };
}

async function resolveVehicleReference(vehicleNumber) {
  if (typeof vehicleNumber !== 'string' || !vehicleNumber.trim()) return { status: 'not_found' };
  const normalized = normalizeVehicleNumber(vehicleNumber);
  if (!normalized) return { status: 'not_found' };
  const vehicles = await Vehicle.find({ status: 'Active' })
    .select('_id vehicleNumber')
    .lean();
  const matches = vehicles.filter((vehicle) =>
    normalizeVehicleNumber(vehicle.vehicleNumber) === normalized
  );
  if (matches.length === 1) return { status: 'matched', vehicle: matches[0] };
  if (matches.length > 1) return { status: 'ambiguous' };
  if (/^\d{4,6}$/.test(normalized)) {
    const suffixMatches = vehicles.filter((vehicle) =>
      normalizeVehicleNumber(vehicle.vehicleNumber).endsWith(normalized)
    );
    if (suffixMatches.length === 1) return { status: 'matched', vehicle: suffixMatches[0] };
    if (suffixMatches.length > 1) return { status: 'ambiguous' };
  }
  return { status: 'not_found' };
}

function isValidPosition(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180 &&
    !(latitude === 0 && longitude === 0);
}

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function safeSpeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function safeIgnition(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(on|yes|1|true)$/i.test(value.trim())) return true;
    if (/^(off|no|0|false)$/i.test(value.trim())) return false;
  }
  return null;
}

function isFreshGps(timestamp, now) {
  const date = validDate(timestamp);
  return Boolean(date && date <= now && now.getTime() - date.getTime() <= GPS_STALE_THRESHOLD_MS);
}

async function getCurrentVehicleLocation({ vehicleNumber } = {}) {
  if (typeof vehicleNumber !== 'string' || !vehicleNumber.trim()) {
    return { message: EXACT_VEHICLE_MESSAGE };
  }
  const resolution = await resolveVehicleReference(vehicleNumber);
  if (resolution.status === 'ambiguous') return { message: EXACT_VEHICLE_MESSAGE };
  if (resolution.status !== 'matched') return { message: NOT_REGISTERED_MESSAGE };

  const vehicleId = resolution.vehicle._id;
  const now = new Date();
  const [historyFix, statuses, plants] = await Promise.all([
    GpsHistory.findOne({
      vehicleId,
      archived: { $ne: true },
      gpsTimestamp: { $lte: now },
      latitude: { $gte: -90, $lte: 90 },
      longitude: { $gte: -180, $lte: 180 },
      $nor: [{ latitude: 0, longitude: 0 }],
    })
      .select('provider latitude longitude address speed ignition gpsTimestamp geofence_status plantId plantName')
      .sort({ gpsTimestamp: -1 })
      .lean(),
    VehicleCurrentStatus.find({
      vehicleId,
      archived: { $ne: true },
      latest_gps_timestamp: { $lte: now },
    })
      .select('provider latitude longitude address speed ignition latest_gps_timestamp current_geofence current_plant currentPlantId lastExitPlantName lastExitDateTime lastExitGpsTimestamp')
      .sort({ latest_gps_timestamp: -1 })
      .lean(),
    Plant.find({ status: 'Active' })
      .select('_id plantName location radiusMeters latitude longitude')
      .lean(),
  ]);

  const statusFix = statuses.find((status) =>
    isValidPosition(status.latitude, status.longitude) && validDate(status.latest_gps_timestamp)
  );
  const historyTimestamp = validDate(historyFix?.gpsTimestamp);
  const statusTimestamp = validDate(statusFix?.latest_gps_timestamp);
  const useStatusFix = statusFix && (!historyFix || !historyTimestamp ||
    (statusTimestamp && statusTimestamp > historyTimestamp));
  const fix = useStatusFix ? {
    provider: statusFix.provider,
    latitude: statusFix.latitude,
    longitude: statusFix.longitude,
    address: statusFix.address,
    speed: statusFix.speed,
    ignition: statusFix.ignition,
    gpsTimestamp: statusFix.latest_gps_timestamp,
    geofence_status: statusFix.current_geofence,
    plantName: statusFix.current_plant,
    plantId: statusFix.currentPlantId,
  } : historyFix;

  if (!fix || !isValidPosition(fix.latitude, fix.longitude) || !validDate(fix.gpsTimestamp)) {
    return { message: UNAVAILABLE_MESSAGE };
  }

  const provider = normalizeGpsProvider(fix.provider, '');
  const providerStatus = provider ? statuses.find((status) =>
    provider && normalizeGpsProvider(status.provider, '') === provider
  ) : statusFix;
  const geofence = getVehiclePlantStatus(
    { latitude: fix.latitude, longitude: fix.longitude, gpsTimestamp: fix.gpsTimestamp },
    plants,
    { now }
  );
  const savedGeofence = String(fix.geofence_status || providerStatus?.current_geofence || '').toUpperCase();
  const plantStatus = geofence.isStale && ['INSIDE', 'OUTSIDE'].includes(savedGeofence)
    ? savedGeofence === 'INSIDE' ? 'Inside' : 'Outside'
    : geofence.isInside ? 'Inside' : 'Outside';
  const matchedPlant = plants.find((plant) =>
    String(plant._id) === String(fix.plantId || providerStatus?.currentPlantId || '')
  );
  const plantName = plantStatus === 'Inside'
    ? sanitizeDisplayText(fix.plantName || providerStatus?.current_plant || matchedPlant?.plantName)
    : '';
  const providerAddress = typeof fix.address === 'string' ? fix.address : '';
  const location = plantStatus === 'Inside' && plantName
    ? plantName
    : isReadableProviderAddress(providerAddress)
      ? sanitizeDisplayText(providerAddress)
      : sanitizeDisplayText(getReadableLocation(fix.latitude, fix.longitude, plants));

  return {
    vehicleNumber: sanitizeDisplayText(resolution.vehicle.vehicleNumber, 32),
    location: location || 'Location unavailable',
    plantStatus,
    plantName: plantName || null,
    lastPlantLeft: sanitizeDisplayText(providerStatus?.lastExitPlantName) || null,
    lastPlantLeftAt: providerStatus?.lastExitDateTime || providerStatus?.lastExitGpsTimestamp || null,
    gpsTimestamp: validDate(fix.gpsTimestamp),
    speed: safeSpeed(fix.speed),
    ignition: safeIgnition(fix.ignition),
    isStale: !isFreshGps(fix.gpsTimestamp, now),
  };
}

function getSafeSyncErrorCode(error) {
  const status = Number(error?.response?.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) return `HTTP_${status}`;
  const code = String(error?.code || '').toUpperCase();
  if (/^MISSING_ENV_[A-Z0-9_]{2,60}$/.test(code)) return code;
  if (/^HTTP_\d{3}$/.test(code)) return code;
  return SAFE_SYNC_ERROR_CODES.has(code) ? code : 'SYNC_FAILED';
}

function safeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

async function syncProviders(user, provider = null) {
  if (user?.role !== 'Admin') {
    const error = new Error('Only administrators can start GPS synchronization from Sikka AI.');
    error.code = 'ADMIN_REQUIRED';
    throw error;
  }
  if (provider !== null && !['FLEETX', 'WHEELSEYE'].includes(provider)) {
    const error = new Error('Invalid GPS provider.');
    error.code = 'INVALID_PROVIDER';
    throw error;
  }

  const { syncBothGpsProviders, syncProviderGps } = require('./gpsSyncEngine');
  const results = provider
    ? await syncProviderGps({ provider, mode: 'MANUAL', caller: 'Sikka AI' })
      .then((result) => ({ [provider === 'FLEETX' ? 'fleetx' : 'wheelseye']: result }))
      .catch((error) => ({
        [provider === 'FLEETX' ? 'fleetx' : 'wheelseye']: {
          status: 'FAILED',
          errorCode: getSafeSyncErrorCode(error),
        },
      }))
    : await syncBothGpsProviders({ mode: 'MANUAL', caller: 'Sikka AI' });

  return Object.fromEntries(Object.entries(results)
    .filter(([name]) => ['fleetx', 'wheelseye'].includes(name.toLowerCase()))
    .map(([name, result]) => {
      const savedCount = safeCount(result.savedCount ?? result.successCount);
      const failedCount = safeCount(result.failedCount);
      const status = ['SUCCESS', 'PARTIAL', 'FAILED'].includes(result.status)
        ? result.status
        : failedCount > 0
          ? savedCount > 0 ? 'PARTIAL' : 'FAILED'
          : result.success ? 'SUCCESS' : 'FAILED';
      return [name.toLowerCase(), {
        status,
        totalVehicles: safeCount(result.totalVehicles),
        receivedCount: safeCount(result.receivedCount),
        matchedCount: safeCount(result.matchedCount),
        savedCount,
        unchangedCount: safeCount(result.unchangedCount),
        failedCount,
        errorCode: result.errorCode ? getSafeSyncErrorCode({ code: result.errorCode }) : null,
      }];
    }));
}

async function executeToolCall(call, user) {
  const args = call?.args && typeof call.args === 'object' && !Array.isArray(call.args) ? call.args : {};
  if (call?.name === 'sync_gps') return syncProviders(user, args.provider ?? null);
  if (call?.name === 'get_vehicle_location') return getCurrentVehicleLocation(args);
  return { message: UNSUPPORTED_MESSAGE, unsupported: true };
}

function formatToolAnswer(results) {
  const result = results?.[results.length - 1];
  if (!result || !ALLOWED_AI_ACTIONS.includes(result.tool)) return UNSUPPORTED_MESSAGE;
  const data = result.data || {};
  if (result.tool === 'get_vehicle_location') {
    if (data.message) return data.message;
    const plant = data.plantStatus === 'Inside'
      ? `Inside ${sanitizeDisplayText(data.plantName) || 'plant name unavailable'}`
      : data.lastPlantLeft
        ? `Outside; last left ${sanitizeDisplayText(data.lastPlantLeft)}${data.lastPlantLeftAt ? ` at ${formatIstTimestamp(data.lastPlantLeftAt)}` : ''}`
        : 'Outside; no recorded plant exit';
    return [
      `Vehicle: ${sanitizeDisplayText(data.vehicleNumber, 32) || 'record not available'}`,
      `Location: ${sanitizeDisplayText(data.location) || 'Location unavailable'}`,
      `Last GPS update: ${formatIstTimestamp(data.gpsTimestamp)}`,
      `Speed: ${data.speed ?? 'record not available'}`,
      `Ignition: ${data.ignition === true ? 'On' : data.ignition === false ? 'Off' : 'record not available'}`,
      `Plant: ${plant}`,
      ...(data.isStale ? ['GPS fix is older than the live-data threshold.'] : []),
    ].join('\n');
  }

  const providerNames = { wheelseye: 'WheelsEye', fleetx: 'FleetX' };
  const summaries = Object.entries(data).map(([provider, resultData]) => {
    const label = providerNames[provider];
    if (!label || !resultData || typeof resultData !== 'object') return null;
    const status = ['SUCCESS', 'PARTIAL', 'FAILED'].includes(resultData.status)
      ? resultData.status
      : 'FAILED';
    const counts = `${safeCount(resultData.savedCount)} saved, ${safeCount(resultData.failedCount)} failed`;
    const error = resultData.errorCode ? ` (${getSafeSyncErrorCode({ code: resultData.errorCode })})` : '';
    return `${label}: ${status}; ${counts}${error}`;
  }).filter(Boolean);
  return summaries.length ? `GPS sync finished. ${summaries.join('. ')}` : 'GPS sync finished.';
}

function getSyncNotice(results) {
  const result = results?.[results.length - 1];
  if (result?.tool !== 'sync_gps') return null;
  const failed = Object.entries(result.data || {})
    .filter(([, provider]) => ['FAILED', 'PARTIAL'].includes(provider?.status))
    .map(([provider]) => provider === 'fleetx' ? 'FleetX' : 'WheelsEye');
  return failed.length
    ? `GPS sync failed or was partial for ${[...new Set(failed)].join(' and ')}. Previously saved GPS positions are retained.`
    : null;
}

module.exports = {
  ALLOWED_AI_ACTIONS,
  NOT_REGISTERED_MESSAGE,
  UNAVAILABLE_MESSAGE,
  UNSUPPORTED_MESSAGE,
  hashQuery,
  extractVehicleToken,
  recognizeQuestion,
  resolveVehicleReference,
  executeToolCall,
  formatToolAnswer,
  getSyncNotice,
};
