const { createHash } = require('crypto');
const Vehicle = require('../models/Vehicle');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const GpsHistory = require('../models/GpsHistory');
const Plant = require('../models/Plant');
const PlantEntry = require('../models/PlantEntry');
const ZoneSession = require('../models/ZoneSession');
const Driver = require('../models/Driver');
const DriverPlantRecord = require('../models/DriverPlantRecord');
const DriverLocation = require('../models/DriverLocation');
const GpsSetting = require('../models/GpsSetting');
const GpsSyncLog = require('../models/GpsSyncLog');
const VehicleLocation = require('../models/VehicleLocation');
const { GPS_STALE_THRESHOLD_MS } = require('../config/gps');
const { getFleetGpsSnapshot } = require('./gpsDataService');
const { getReadableLocation, isReadableProviderAddress } = require('./locationHelper');
const { reverseGeocode } = require('./reverseGeocodeService');
const { generateFleetReport } = require('./reportCalculationService');
const {
  MAX_GPS_GAP_MS,
  istDateString,
  msToHHMM,
  normalizeVehicleNumber,
} = require('./gpsTimelineService');

const FUTURE_DATA_MESSAGE =
  'Future vehicle location data is not available. Sikka AI provides actual current and historical records only.';
const UNAVAILABLE_MESSAGE = 'Required information is not available in the Sikka Fleet database.';
const NOT_REGISTERED_MESSAGE = 'This vehicle is not registered in Sikka Fleet.';
const UNSUPPORTED_MESSAGE =
  'I can help with Sikka Fleet vehicles, GPS locations and history, plant availability and movements, reports, and GPS sync status.';
const MAX_HISTORY_RECORDS = 1000;
const MAX_REPORT_DAYS = 31;
const TIME_ZONE = 'Asia/Kolkata';

function hashQuery(query) {
  return createHash('sha256').update(String(query)).digest('hex');
}

function normalizeQuestion(question) {
  return String(question || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

function levenshteinDistance(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const old = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
      diagonal = old;
    }
  }
  return previous[b.length];
}

function hasKeyword(question, keywords) {
  const normalized = normalizeQuestion(question);
  const tokens = normalized.split(/\s+/);
  return keywords.some((keyword) => {
    const term = normalizeQuestion(keyword);
    if (!term) return false;
    if (normalized.includes(term)) return true;
    if (!/^[a-z]+$/.test(term) || term.length < 4) return false;
    const maxDistance = term.length >= 7 ? 2 : 1;
    return tokens.some((token) =>
      /^[a-z]+$/.test(token) &&
      Math.abs(token.length - term.length) <= maxDistance &&
      levenshteinDistance(token, term) <= maxDistance
    );
  });
}

function hasWord(question, words) {
  const tokens = normalizeQuestion(question).split(/\s+/);
  return words.some((word) => tokens.includes(normalizeQuestion(word)));
}

function hasFuzzyKeyword(question) {
  const tokens = normalizeQuestion(question).split(/\s+/);
  return ['where', 'location', 'vehicle', 'vehicles', 'plant', 'inside', 'outside', 'history', 'report', 'sync']
    .some((keyword) => tokens.some((token) =>
      token !== keyword &&
      token !== `${keyword}s` &&
      /^[a-z]+$/.test(token) &&
      Math.abs(token.length - keyword.length) <= 1 &&
      levenshteinDistance(token, keyword) === 1
    ));
}

function getLanguage(question) {
  if (/[\u0900-\u097f]/.test(question)) return 'hi';
  return hasKeyword(question, [
    'gaadi', 'gadi', 'kahan', 'kahaan', 'kidhar', 'abhi', 'hai', 'tha',
    'thi', 'kaun', 'kitna', 'kitne', 'kitni', 'andar', 'bahar', 'nikli',
  ]) ? 'hinglish' : 'en';
}

function getSuggestions(language, vehicleNumber = null) {
  if (vehicleNumber) {
    return [
      localize(language, `Current location of ${vehicleNumber}`, `${vehicleNumber} ki abhi ki location`, `${vehicleNumber} ki abhi location`),
      localize(language, `${vehicleNumber} location yesterday`, `${vehicleNumber} kal kahan thi`, `${vehicleNumber} kal kahan thi`),
      localize(language, `${vehicleNumber} plant stay hours today`, `${vehicleNumber} ke aaj ke plant stay hours`, `${vehicleNumber} ke aaj plant stay hours`),
      localize(language, 'GPS sync status', 'GPS sync ki sthiti', 'GPS sync status'),
    ];
  }
  return [
    localize(language, 'Current location of a vehicle', 'किसी वाहन की वर्तमान लोकेशन', 'Kisi gaadi ki current location'),
    localize(language, 'Vehicles in Salt Plant', 'Salt Plant में कौन-से वाहन हैं', 'Salt Plant me kaun si gaadiyan hain'),
    localize(language, 'Moving, stopped, and ignition status', 'चलते, रुके और ignition की स्थिति', 'Moving, stopped aur ignition status'),
    localize(language, 'GPS sync status', 'GPS sync की स्थिति', 'GPS sync status'),
  ];
}

function formatIstTimestamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return 'record not available';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.day}-${values.month}-${values.year} ${values.hour}:${values.minute}`;
}

function formatLocationTimestamp(value) {
  return formatIstTimestamp(value).replace(/^(\d{2}-\d{2}-\d{4}) /, '$1, ');
}

function providerLabel(provider) {
  if (/fleetx/i.test(String(provider || ''))) return 'FleetX';
  if (/wheels.?eye/i.test(String(provider || ''))) return 'WheelsEye';
  return 'GPS source not available';
}

function localize(language, english, hindi, hinglish = hindi) {
  if (language === 'hi') return hindi;
  if (language === 'hinglish') return hinglish;
  return english;
}

function parseDateBoundary(value, endOfDate = false) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let input = value.trim();
  const dayFirst = input.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dayFirst) input = `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const time = endOfDate ? '23:59:59.999' : '00:00:00.000';
    const parsedDate = new Date(`${input}T${time}+05:30`);
    if (istDateString(parsedDate) !== input) return null;
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  const withTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(input)
    ? input
    : `${input}+05:30`;
  const parsedDate = new Date(withTimezone);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function validatePastRange({ from, to, targetTime }, now = new Date()) {
  const target = targetTime ? parseDateBoundary(targetTime) : null;
  if (targetTime && !target) {
    return { error: 'Use a valid past date or ISO 8601 date/time.' };
  }
  if (target && target.getTime() > now.getTime()) return { error: FUTURE_DATA_MESSAGE };

  const start = target || (from ? parseDateBoundary(from) : null);
  let end = target || (to ? parseDateBoundary(to, true) : null);
  if ((from && !start) || (to && !end)) {
    return { error: 'Use valid past dates or ISO 8601 date/time values.' };
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to.trim()) && to.trim() === istDateString(now) && end > now) {
    end = now;
  }
  if (!start || !end) return { error: 'Specify a past date or date range to search GPS history.' };
  if (start.getTime() > now.getTime() || end.getTime() > now.getTime()) {
    return { error: FUTURE_DATA_MESSAGE };
  }
  if (start.getTime() > end.getTime()) {
    return { error: 'The start of the requested date range must be before its end.' };
  }
  return { start, end };
}

function extractVehicleToken(question) {
  const input = String(question || '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/g, ' ');
  const registration = input.match(/\b([a-z]{2}[\s-]*\d{2}[\s-]*[a-z]{1,3}[\s-]*\d{1,4})\b/i);
  if (registration) return normalizeVehicleNumber(registration[1]);
  return input.match(/\b\d{4,6}\b/)?.[0] || null;
}

function extractPlantMention(question) {
  const normalized = normalizeQuestion(question);
  const plantName = /salt|namak|नमक/.test(normalized)
    ? 'Salt Plant'
    : /tea|chai|चाय/.test(normalized)
      ? 'Tea Plant'
      : /dasna|दसना/.test(normalized)
        ? 'DASNA'
        : null;
  const id = question.match(/\bplant\s*(?:id|#)\s*([a-z0-9_-]+)\b/i)?.[1];
  return {
    plantId: id || null,
    plantName,
  };
}

function extractProvider(question) {
  if (/\bfleet[\s-]?x\b/i.test(question)) return 'FLEETX';
  if (/\bwheels[\s-]?eye\b/i.test(question)) return 'WHEELSEYE';
  return null;
}

function extractDateRange(question, now = new Date()) {
  const normalized = normalizeQuestion(question);
  const relative = normalized.match(/\b(?:last|past)\s+(\d{1,3})\s+(hour|hours|day|days|week|weeks)\b/);
  if (relative) {
    const count = Number(relative[1]);
    const unit = relative[2];
    const multiplier = unit.startsWith('hour') ? 60 * 60 * 1000
      : unit.startsWith('week') ? 7 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;
    return {
      from: new Date(now.getTime() - count * multiplier).toISOString(),
      to: now.toISOString(),
    };
  }
  const relativeDays = normalized.match(/(?:last|past|previous|pichhle|pichlay|पिछले|पिछला)\s+(\d{1,2})\s+(?:days?|din|दिन)/);
  if (relativeDays) {
    const count = Number(relativeDays[1]);
    if (count < 1) return { error: 'Use a date range of at least one day.' };
    const today = istDateString(now);
    const todayStart = parseDateBoundary(today);
    const firstDay = istDateString(new Date(todayStart.getTime() - (count - 1) * 24 * 60 * 60 * 1000));
    return { from: firstDay, to: today };
  }

  const today = istDateString(now);
  let selectedDate = null;
  const yesterday = hasKeyword(question, ['yesterday', 'kal', 'कल']);
  const twoDaysAgo = hasKeyword(question, ['parso', 'परसों']);
  const pastMarker = hasKeyword(question, ['yesterday', 'was', 'were', 'tha', 'thi', 'थे', 'थी', 'था']);
  const futureMarker = hasKeyword(question, ['tomorrow', 'hoga', 'hogi', 'rahega', 'rahegi', 'होगा', 'होगी', 'रहेगा', 'रहेगी']);
  if (yesterday || twoDaysAgo) {
    if (futureMarker) return { error: FUTURE_DATA_MESSAGE };
    if (!pastMarker) return { clarification: twoDaysAgo ? 'parso' : 'kal' };
    const daysBack = twoDaysAgo ? 2 : 1;
    selectedDate = istDateString(new Date(parseDateBoundary(today).getTime() - daysBack * 24 * 60 * 60 * 1000));
  } else if (hasKeyword(question, ['today', 'aaj', 'आज'])) {
    selectedDate = today;
  } else if (futureMarker || hasKeyword(question, ['tomorrow', 'कल'])) {
    return { error: FUTURE_DATA_MESSAGE };
  }
  const dateMatch = question.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/);
  if (dateMatch) {
    const date = parseDateBoundary(dateMatch[1]);
    if (!date) return { error: 'Use a valid date such as YYYY-MM-DD or DD/MM/YYYY.' };
    selectedDate = istDateString(date);
  }
  const timeMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (timeMatch) {
    const rawHour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] || 0);
    if (rawHour < 1 || rawHour > 12 || minute > 59) {
      return { error: 'Use a valid time such as 10:30 AM.' };
    }
    const hour = rawHour % 12 + (timeMatch[3] === 'pm' ? 12 : 0);
    return {
      targetTime: `${selectedDate || today}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`,
    };
  }
  if (selectedDate) return { from: selectedDate, to: selectedDate };
  return null;
}

function recognizeQuestion(question, now = new Date()) {
  const language = getLanguage(question);
  const vehicleNumber = extractVehicleToken(question);
  const provider = extractProvider(question);
  const { plantId, plantName } = extractPlantMention(question);
  const dateRange = extractDateRange(question, now);
  const dateArgs = dateRange?.error ? { dateError: dateRange.error } : dateRange || {};
  if (dateRange?.clarification) {
    return { tool: 'clarify_date', args: { dateTerm: dateRange.clarification }, language };
  }
  if (dateRange?.error === FUTURE_DATA_MESSAGE) {
    return { tool: 'future_refusal', args: {}, language };
  }
  if (dateRange?.error) {
    return { tool: 'invalid_date', args: { message: dateRange.error }, language, suggestions: getSuggestions(language, vehicleNumber) };
  }
  if (dateRange && !dateRange.clarification) {
    const validatedRange = validatePastRange(dateRange, now);
    if (validatedRange.error === FUTURE_DATA_MESSAGE) {
      return { tool: 'future_refusal', args: {}, language };
    }
    if (validatedRange.error) {
      return { tool: 'invalid_date', args: { message: validatedRange.error }, language, suggestions: getSuggestions(language, vehicleNumber) };
    }
  }
  if (hasKeyword(question, ['sync status', 'sync health', 'last sync', 'next sync', 'connection status', 'provider status', 'sync ki sthiti'])) {
    return { tool: 'get_gps_sync_status', args: { provider }, language };
  }
  if (hasKeyword(question, ['sync', 'synchronize', 'refresh', 'update', 'fetch', 'sync karo', 'sync kar do']) &&
      hasKeyword(question, ['gps', 'location', 'vehicle', 'fleet', 'wheelseye', 'fleetx', 'gaadi', 'गाड़ी'])) {
    return { tool: 'sync_gps_now', args: { provider, vehicleNumber }, language };
  }
  if (hasKeyword(question, ['daily report', 'gps report', 'report', 'रिपोर्ट']) && vehicleNumber) {
    return { tool: 'get_daily_report', args: { vehicleNumber, ...dateArgs }, language };
  }
  if ((hasKeyword(question, ['trip plan', 'next trip', 'plan details']) || hasWord(question, ['plan'])) && vehicleNumber) {
    return { tool: 'get_vehicle_plans', args: { vehicleNumber }, language };
  }
  if (hasKeyword(question, ['entry', 'exit', 'entered', 'exited', 'arrival', 'departure', 'visit', 'left', 'leave', 'nikli', 'nikla', 'bahar nikli', 'बाहर निकली', 'निकली', 'निकला']) ||
      hasKeyword(question, ['plant movement', 'plant entry', 'plant exit']) ||
      (hasKeyword(question, ['movement']) && hasKeyword(question, ['plant', 'salt', 'tea', 'dasna']))) {
    return {
      tool: 'get_plant_movements',
      args: { vehicleNumber, plantId, plantName, ...dateArgs },
      language,
    };
  }
  const mentionsPlant = hasKeyword(question, ['plant', 'plants', 'salt', 'tea', 'dasna', 'प्लांट']);
  const asksPlantList = hasKeyword(question, ['inside', 'outside', 'availability', 'available', 'how many', 'list', 'show', 'which', 'who', 'andar', 'bahar', 'kaun', 'kitni', 'kitne', 'कौन', 'अंदर', 'बाहर']) ||
    hasWord(question, ['in', 'at', 'me', 'mein', 'में', 'पर']);
  if ((mentionsPlant && (asksPlantList || hasKeyword(question, ['vehicle', 'vehicles', 'gaadi', 'गाड़ी']))) ||
      hasKeyword(question, ['vehicles outside', 'vehicles inside'])) {
    return {
      tool: 'get_plant_availability',
      args: {
        plantId,
        plantName,
        includeVehicles: asksPlantList || hasKeyword(question, ['list', 'show', 'which', 'kaun', 'कौन']),
        status: hasKeyword(question, ['outside', 'bahar', 'बाहर'])
          ? 'OUTSIDE'
          : hasKeyword(question, ['inside', 'andar', 'अंदर'])
            ? 'INSIDE'
            : null,
      },
      language,
      liveQuery: true,
    };
  }
  if (hasKeyword(question, ['stoppage', 'stoppages', 'stopped', 'stop duration', 'moving', 'movement', 'speed']) && vehicleNumber) {
    return { tool: 'get_vehicle_movement', args: { vehicleNumber, provider, ...dateArgs }, language };
  }
  if (hasKeyword(question, ['count', 'total', 'moving', 'stopped', 'ignition', 'how many', 'status', 'कितने', 'कितनी']) &&
      hasKeyword(question, ['vehicle', 'vehicles', 'fleet', 'gaadi', 'गाड़ी'])) {
    return { tool: 'get_fleet_status', args: {}, language, liveQuery: true };
  }
  if (vehicleNumber && hasKeyword(question, ['details', 'detail', 'full info', 'more info', 'stay', 'hours', 'ghante', 'ghanta', 'kitni der', 'कितने घंटे', 'कितनी देर'])) {
    return dateRange
      ? { tool: 'get_daily_report', args: { vehicleNumber, ...dateArgs }, language }
      : { tool: 'get_vehicle_details', args: { vehicleNumber, provider }, language, liveQuery: true };
  }
  const hasPastDate = Boolean(dateRange && !dateRange.error && !dateRange.clarification);
  if (vehicleNumber && (hasKeyword(question, ['history', 'historical', 'where was', 'location on', 'location at', 'gps trail', 'route history', 'kahan thi', 'kahan tha', 'कहाँ थी', 'कहाँ था']) || hasPastDate)) {
    return { tool: 'get_vehicle_history', args: { vehicleNumber, provider, ...dateArgs }, language };
  }
  if (vehicleNumber && hasKeyword(question, ['where', 'location', 'position', 'gps', 'currently', 'current', 'now', 'latest', 'kahan', 'kidhar', 'abhi', 'जगह', 'कहाँ', 'कहां'])) {
    return { tool: 'get_vehicle_location', args: { vehicleNumber, provider }, language, liveQuery: true };
  }
  if (hasKeyword(question, ['all vehicles', 'list vehicles', 'registered vehicles', 'count vehicles', 'how many vehicles', 'saari gaadi', 'sabhi gaadi', 'सभी गाड़ी'])) {
    return { tool: 'get_registered_vehicles', args: {}, language, liveQuery: true };
  }
  if (hasKeyword(question, ['location', 'position', 'history', 'movement', 'stoppage', 'kahan', 'कहाँ']) &&
      hasKeyword(question, ['vehicle', 'truck', 'registration', 'gaadi', 'गाड़ी'])) {
    return {
      tool: 'request_vehicle_number',
      args: {},
      language,
      suggestions: getSuggestions(language),
    };
  }
  return { tool: 'unsupported', args: {}, language, suggestions: getSuggestions(language, vehicleNumber) };
}

async function resolveVehicleReference(vehicleNumber) {
  if (typeof vehicleNumber !== 'string' || !vehicleNumber.trim()) return { status: 'not_found' };
  const normalized = normalizeVehicleNumber(vehicleNumber);
  if (!normalized) return { status: 'not_found' };
  const vehicles = await Vehicle.find({})
    .select('_id vehicleNumber status')
    .lean();
  const exactMatches = vehicles.filter((vehicle) =>
    normalizeVehicleNumber(vehicle.vehicleNumber) === normalized
  );
  if (exactMatches.length === 1) return { status: 'matched', vehicle: exactMatches[0] };
  if (exactMatches.length > 1) return { status: 'ambiguous', candidates: exactMatches };
  if (/^\d{4,6}$/.test(normalized)) {
    const suffixMatches = vehicles.filter((vehicle) =>
      normalizeVehicleNumber(vehicle.vehicleNumber).endsWith(normalized)
    );
    if (suffixMatches.length === 1) return { status: 'matched', vehicle: suffixMatches[0] };
    if (suffixMatches.length > 1) return { status: 'ambiguous', candidates: suffixMatches };
  }
  return { status: 'not_found' };
}

async function findRegisteredVehicle(vehicleNumber) {
  const resolution = await resolveVehicleReference(vehicleNumber);
  return resolution.status === 'matched' ? resolution.vehicle : null;
}

function gpsIsFresh(timestamp, now) {
  const gpsDate = timestamp ? new Date(timestamp) : null;
  return Boolean(gpsDate && Number.isFinite(gpsDate.getTime()) &&
    gpsDate.getTime() <= now.getTime() &&
    now.getTime() - gpsDate.getTime() <= GPS_STALE_THRESHOLD_MS);
}

function getSafeGeocoderErrorCode(error) {
  const status = Number(error?.response?.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) return `HTTP_${status}`;
  const code = String(error?.code || '').toUpperCase();
  if (/^[A-Z0-9_]{2,40}$/.test(code)) return code;
  if (/timeout/i.test(String(error?.message || ''))) return 'REQUEST_TIMEOUT';
  return 'GEOCODER_UNAVAILABLE';
}

function getSafeSyncErrorCode(error) {
  const status = Number(error?.response?.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) return `HTTP_${status}`;
  const code = String(error?.code || '').toUpperCase();
  if (/^[A-Z0-9_]{2,40}$/.test(code)) return code;
  if (/timeout/i.test(String(error?.message || ''))) return 'REQUEST_TIMEOUT';
  return 'SYNC_FAILED';
}

async function getReadableVehicleAddress({ location, item, vehicle, plants, provider, gpsTimestamp, plantStatus, plantName }) {
  if (plantStatus === 'Inside' && plantName) return plantName;
  const providerAddress = location.address || item.address || '';
  let address = isReadableProviderAddress(providerAddress) ? providerAddress.trim() : '';
  if (!address) {
    try {
      address = await reverseGeocode(location.latitude, location.longitude) || '';
    } catch (error) {
      console.warn('[Sikka AI] Reverse geocoding unavailable:', getSafeGeocoderErrorCode(error));
    }
  }
  if (!address) {
    address = getReadableLocation(location.latitude, location.longitude, plants);
  }

  const providerPattern = /fleetx/i.test(String(provider || '')) ? /fleetx/i : /wheels.?eye/i;
  const timestamp = new Date(gpsTimestamp);
  await Promise.all([
    GpsHistory.updateOne(
      { vehicleId: vehicle._id, provider: providerPattern, gpsTimestamp: timestamp },
      { $set: { address } }
    ),
    VehicleLocation.updateOne(
      { vehicleId: vehicle._id, provider: providerPattern, gpsDateTime: timestamp },
      { $set: { address } }
    ),
    VehicleCurrentStatus.updateOne(
      { vehicleId: vehicle._id, provider: providerPattern, archived: { $ne: true } },
      { $set: { address } }
    ),
  ]);
  return address;
}

async function needsAiGpsSync(intent, now = new Date()) {
  const syncableTools = new Set([
    'get_vehicle_location',
    'get_vehicle_details',
    'get_plant_availability',
    'get_fleet_status',
    'get_registered_vehicles',
  ]);
  if (!intent?.liveQuery || !syncableTools.has(intent.tool)) return false;
  if (intent.args?.vehicleNumber) {
    const resolution = await resolveVehicleReference(intent.args.vehicleNumber);
    if (resolution.status !== 'matched') return false;
    const snapshot = await getFleetGpsSnapshot({ allowPartial: true });
    const item = snapshot.fleet.find((entry) => String(entry.vehicle._id) === String(resolution.vehicle._id));
    if (!item) return true;
    const location = intent.args.provider
      ? item.providerLocations.find((entry) => providerLabel(entry.provider) === providerLabel(intent.args.provider))
      : item;
    const timestamp = location?.providerTimestamp || item.gpsTimestamp;
    return !gpsIsFresh(timestamp, now);
  }
  const snapshot = await getFleetGpsSnapshot({ allowPartial: true });
  return !gpsIsFresh(snapshot.lastUpdated, now);
}

async function getCurrentVehicleLocation({ vehicleNumber, provider }) {
  const vehicle = await findRegisteredVehicle(vehicleNumber);
  if (!vehicle) return { message: NOT_REGISTERED_MESSAGE };

  const snapshot = await getFleetGpsSnapshot({ allowPartial: true });
  const item = snapshot.fleet.find((entry) => String(entry.vehicle._id) === String(vehicle._id));
  if (!item) {
    return { message: UNAVAILABLE_MESSAGE, vehicleNumber: vehicle.vehicleNumber };
  }
  let location = provider
    ? item.providerLocations.find((entry) => providerLabel(entry.provider) === providerLabel(provider))
    : item;
  if (!location?.hasGps ||
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude) ||
      (location.latitude === 0 && location.longitude === 0)) {
    return { message: UNAVAILABLE_MESSAGE, vehicleNumber: vehicle.vehicleNumber };
  }
  let gpsTimestamp = location.providerTimestamp || item.gpsTimestamp;
  let usedPastFix = false;
  const timestampDate = gpsTimestamp ? new Date(gpsTimestamp) : null;
  if (!timestampDate || !Number.isFinite(timestampDate.getTime()) || timestampDate.getTime() > Date.now()) {
    const pastFixQuery = {
      vehicleId: vehicle._id,
      archived: { $ne: true },
      gpsTimestamp: { $lte: new Date() },
    };
    if (provider === 'FLEETX') pastFixQuery.provider = /fleetx/i;
    if (provider === 'WHEELSEYE') pastFixQuery.provider = /wheels.?eye/i;
    const pastFix = await GpsHistory.findOne(pastFixQuery)
      .sort({ gpsTimestamp: -1 })
      .lean();
    if (!pastFix) return { message: UNAVAILABLE_MESSAGE, vehicleNumber: vehicle.vehicleNumber };
    usedPastFix = true;
    location = {
      ...location,
      provider: pastFix.provider,
      providerTimestamp: pastFix.gpsTimestamp,
      latitude: pastFix.latitude,
      longitude: pastFix.longitude,
      address: pastFix.address || '',
      status: pastFix.geofence_status === 'INSIDE'
        ? 'Inside'
        : pastFix.geofence_status === 'OUTSIDE' ? 'Outside' : 'Unknown',
      plantName: pastFix.plantName || null,
      speed: pastFix.speed ?? null,
      ignition: pastFix.ignition ?? null,
      movementStatus: Number(pastFix.speed) > 0 ? 'Moving' : Number(pastFix.speed) === 0 ? 'Stopped' : 'Unknown',
      stayHours: null,
      outsideSince: null,
      outsideHours: null,
      gpsStatus: 'GPS STALE',
      isStale: true,
    };
    gpsTimestamp = pastFix.gpsTimestamp;
  }
  const isFresh = !location.isStale && gpsIsFresh(gpsTimestamp, new Date());
  const plantStatus = location.status === 'Inside' || (!provider && !usedPastFix && item.status === 'Inside')
    ? 'Inside'
    : location.status === 'Outside' || (!provider && !usedPastFix && item.status === 'Outside')
      ? 'Outside'
      : 'Unknown';
  const plantName = plantStatus === 'Inside'
    ? location.plantName || (!usedPastFix ? item.plantName : null) || null
    : null;
  const readableLocation = await getReadableVehicleAddress({
    location,
    item,
    vehicle,
    plants: snapshot.plants,
    provider: location.provider || item.provider,
    gpsTimestamp,
    plantStatus,
    plantName,
  });
  return {
    message: isFresh ? 'Latest saved GPS fix.' : 'GPS data is older than 30 minutes; showing the saved fix.',
    vehicleNumber: vehicle.vehicleNumber,
    registrationStatus: 'Registered',
    vehicleStatus: vehicle.status,
    provider: location.provider || item.provider || null,
    dataSource: providerLabel(location.provider || item.provider),
    location: readableLocation,
    plantStatus,
    plantName,
    latitude: location.latitude,
    longitude: location.longitude,
    gpsTimestamp,
    speed: location.speed ?? null,
    ignition: location.ignition ?? null,
    movementStatus: location.movementStatus || (Number(location.speed) > 0 ? 'Moving' : Number(location.speed) === 0 ? 'Stopped' : 'Unknown'),
    stayHours: location.stayHours || (!usedPastFix ? item.stayHours : null) || null,
    outsideSince: usedPastFix ? null : item.outsideSince || null,
    outsideHours: location.outsideHours || (!usedPastFix ? item.outsideHours : null) || null,
    gpsStatus: location.gpsStatus || item.gpsStatus || 'GPS DATA UNAVAILABLE',
    isStale: !isFresh,
  };
}

async function getVehicleHistory(args) {
  const vehicle = await findRegisteredVehicle(args.vehicleNumber);
  if (!vehicle) return { message: NOT_REGISTERED_MESSAGE };
  if (args.dateError) return { message: args.dateError };
  const now = new Date();
  const range = validatePastRange(args, now);
  if (range.error) return { message: range.error };

  const query = {
    vehicleId: vehicle._id,
    archived: { $ne: true },
    gpsTimestamp: { $gte: range.start, $lte: range.end },
  };
  if (args.provider === 'FLEETX') query.provider = /fleetx/i;
  if (args.provider === 'WHEELSEYE') query.provider = /wheels.?eye/i;
  let historyQuery = GpsHistory.find(query);
  if (args.targetTime) {
    const targetTime = range.end;
    historyQuery = GpsHistory.find({
      vehicleId: vehicle._id,
      archived: { $ne: true },
      gpsTimestamp: {
        $gte: new Date(targetTime.getTime() - GPS_STALE_THRESHOLD_MS),
        $lte: targetTime,
      },
      ...(args.provider === 'FLEETX' ? { provider: /fleetx/i } : {}),
      ...(args.provider === 'WHEELSEYE' ? { provider: /wheels.?eye/i } : {}),
    });
  }
  const records = await historyQuery
    .select('provider latitude longitude address speed ignition gpsTimestamp geofence_status plantId plantName')
    .sort(args.targetTime ? { gpsTimestamp: -1 } : { gpsTimestamp: 1 })
    .limit(args.targetTime ? 1 : MAX_HISTORY_RECORDS)
    .lean();

  if (!records.length) return { message: UNAVAILABLE_MESSAGE, vehicleNumber: vehicle.vehicleNumber, records: [] };
  const plants = await Plant.find({ status: 'Active' })
    .select('plantName location radiusMeters latitude longitude')
    .lean();
  return {
    message: records.length === MAX_HISTORY_RECORDS ? 'Historical GPS records found; result limited to the first 1000 records.' : 'Historical GPS records found.',
    vehicleNumber: vehicle.vehicleNumber,
    records: records.map((record) => ({
      provider: record.provider,
      dataSource: providerLabel(record.provider),
      latitude: record.latitude,
      longitude: record.longitude,
      location: record.geofence_status === 'INSIDE'
        ? record.plantName || getReadableLocation(record.latitude, record.longitude, plants)
        : isReadableProviderAddress(record.address)
          ? record.address
          : getReadableLocation(record.latitude, record.longitude, plants),
      speed: record.speed ?? null,
      ignition: record.ignition ?? null,
      gpsTimestamp: record.gpsTimestamp,
      plantStatus: record.geofence_status === 'INSIDE'
        ? { status: 'Inside', plantName: record.plantName || null, plantId: record.plantId || null }
        : record.geofence_status === 'OUTSIDE'
          ? { status: 'Outside' }
          : { status: 'Unknown / GPS Not Updated' },
    })),
  };
}

async function getRegisteredVehicles() {
  const snapshot = await getFleetGpsSnapshot({ allowPartial: true });
  const records = snapshot.fleet.map((item) => ({
    vehicleNumber: item.vehicle.vehicleNumber,
    registrationStatus: 'Registered',
    vehicleStatus: item.vehicle.status,
    provider: item.provider,
    dataSource: providerLabel(item.provider),
    location: item.hasGps
      ? item.address || getReadableLocation(item.latitude, item.longitude, snapshot.plants)
      : null,
    latitude: item.latitude,
    longitude: item.longitude,
    gpsTimestamp: item.gpsTimestamp,
    gpsStatus: item.gpsStatus,
    movementStatus: item.isStale
      ? 'Unknown'
      : item.storedStatus?.movementStatus ||
        (Number(item.speed) > 0 ? 'Moving' : Number(item.speed) === 0 ? 'Stopped' : 'Unknown'),
    plantStatus: item.isStale ? 'UNKNOWN' : item.status.toUpperCase(),
    plantName: item.isStale ? null : item.plantName,
    speed: item.speed,
    ignition: item.ignition,
    isStale: item.isStale,
  }));
  return {
    message: `${records.length} active registered vehicles from the shared GPS snapshot. Missing or outdated GPS fixes are marked unknown.`,
    count: records.length,
    vehicles: records,
    dataWarnings: snapshot.dataWarnings,
  };
}

function normalizePlantName(name) {
  return normalizeQuestion(name).replace(/\bplant\b/g, '').trim();
}

function plantNameMatches(candidate, requestedName) {
  if (!requestedName) return false;
  const candidateName = normalizePlantName(candidate);
  const requested = normalizePlantName(requestedName);
  return Boolean(candidateName && requested &&
    (candidateName === requested || candidateName.includes(requested) || requested.includes(candidateName)));
}

async function resolvePlant(plantId, plantName) {
  const plants = await Plant.find({}).select('_id plantName location radiusMeters latitude longitude status').lean();
  const id = typeof plantId === 'string' ? plantId.trim().toLowerCase() : '';
  return plants.find((plant) =>
    id && String(plant._id).toLowerCase() === id ||
    plantNameMatches(plant.plantName, plantName) ||
    plantNameMatches(plant.location, plantName)
  ) || null;
}

async function getPlantAvailability({ plantId, plantName, includeVehicles = true, status = null }) {
  const snapshot = await getFleetGpsSnapshot({ allowPartial: true });
  const plant = plantId || plantName
    ? snapshot.plants.find((item) =>
        plantId && String(item._id).toLowerCase() === String(plantId).toLowerCase() ||
        plantNameMatches(item.plantName, plantName) ||
        plantNameMatches(item.location, plantName)
      )
    : null;
  if ((plantId || plantName) && !plant) return { message: UNAVAILABLE_MESSAGE };
  const records = snapshot.fleet.map((item) => {
    const fresh = item.hasGps && !item.isStale;
    return {
      vehicleNumber: item.vehicle.vehicleNumber,
      registered: true,
      vehicleStatus: item.vehicle.status,
      provider: item.provider,
      dataSource: providerLabel(item.provider),
      gpsTimestamp: item.gpsTimestamp,
      plantStatus: fresh ? item.status.toUpperCase() : 'UNKNOWN',
      plantId: fresh ? item.plant?.id || null : null,
      plantName: fresh ? item.plantName || null : null,
      movementStatus: fresh
        ? item.storedStatus?.movementStatus ||
          (Number(item.speed) > 0 ? 'Moving' : Number(item.speed) === 0 ? 'Stopped' : 'Unknown')
        : 'Unknown',
      speed: item.speed,
      ignition: item.ignition,
      isStale: !fresh,
    };
  });

  const plantRecords = plant
    ? records.filter((record) => record.plantStatus === 'INSIDE' && String(record.plantId) === String(plant._id))
    : records;
  const selectedRecords = status
    ? plantRecords.filter((record) => record.plantStatus === status)
    : plantRecords;
  const counts = (subset) => ({
    registered: subset.length,
    inside: subset.filter((record) => record.plantStatus === 'INSIDE').length,
    outside: subset.filter((record) => record.plantStatus === 'OUTSIDE').length,
    unknown: subset.filter((record) => record.plantStatus === 'UNKNOWN').length,
    moving: subset.filter((record) => record.movementStatus === 'Moving').length,
    stopped: subset.filter((record) => record.movementStatus === 'Stopped').length,
    ignitionOn: subset.filter((record) =>
      record.ignition === true || /^(on|yes|1|ignition on)$/i.test(String(record.ignition || '').trim())
    ).length,
    ignitionOff: subset.filter((record) =>
      record.ignition === false || /^(off|no|0|ignition off)$/i.test(String(record.ignition || '').trim())
    ).length,
  });
  const plantAvailability = snapshot.plants.map((item) => {
    const plantRecords = records.filter((record) =>
      record.plantStatus === 'INSIDE' && String(record.plantId) === String(item._id)
    );
    return {
      plantId: String(item._id),
      plantName: item.plantName,
      inside: plantRecords.length,
      vehicles: plantRecords.map((record) => ({
        vehicleNumber: record.vehicleNumber,
        dataSource: record.dataSource,
        gpsTimestamp: record.gpsTimestamp,
      })),
    };
  });

  return {
    message: 'Counts use the shared Sikka Fleet GPS snapshot; missing or outdated GPS fixes are Unknown.',
    ...(plant ? { plant: { plantId: String(plant._id), plantName: plant.plantName, inside: plantRecords.length } } : {}),
    totals: counts(records),
    plantAvailability: plant ? undefined : plantAvailability,
    ...(includeVehicles ? { vehicles: selectedRecords.slice(0, 250) } : {}),
    lastGpsUpdateAt: snapshot.lastUpdated,
    dataWarnings: snapshot.dataWarnings,
  };
}

async function getPlantMovements({ vehicleNumber, plantId, plantName, from, to, targetTime, dateError }) {
  if (dateError) return { message: dateError };
  const now = new Date();
  const range = targetTime
    ? validatePastRange({ targetTime }, now)
    : from || to
      ? validatePastRange({ from: from || '1970-01-01', to: to || now.toISOString() }, now)
    : { start: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), end: now };
  if (range.error) return { message: range.error };

  let vehicle = null;
  let registeredIds;
  if (vehicleNumber) {
    vehicle = await findRegisteredVehicle(vehicleNumber);
    if (!vehicle) return { message: NOT_REGISTERED_MESSAGE };
    registeredIds = [vehicle._id];
  } else {
    registeredIds = (await Vehicle.find({}).select('_id').lean()).map((item) => item._id);
    if (!registeredIds.length) return { message: UNAVAILABLE_MESSAGE, records: [] };
  }
  const plant = plantId || plantName ? await resolvePlant(plantId, plantName) : null;
  if ((plantId || plantName) && !plant) return { message: UNAVAILABLE_MESSAGE };

  const sessionFilter = {
    archived: { $ne: true },
    vehicleId: { $in: registeredIds },
    enteredAt: { $lte: range.end },
    $or: [{ exitedAt: null }, { exitedAt: { $gte: range.start } }],
  };
  const entryFilter = {
    vehicleId: { $in: registeredIds },
    entryDateTime: { $gte: range.start, $lte: range.end },
  };
  if (plant) {
    sessionFilter.plantId = plant._id;
    entryFilter.plantId = plant._id;
  }
  const sessions = await ZoneSession.find(sessionFilter)
    .select('vehicleNumber vehicleNumberNormalized plantId zoneId enteredAt exitedAt lastSeenAt entryGpsTimestamp exitGpsTimestamp provider')
    .sort({ enteredAt: -1 })
    .limit(500)
    .lean();
  const entries = await PlantEntry.find(entryFilter)
    .select('vehicleNumber plantId plantName entryDateTime gpsTimestamp latitude longitude')
    .sort({ entryDateTime: -1 })
    .limit(500)
    .lean();

  if (!sessions.length && !entries.length) return { message: UNAVAILABLE_MESSAGE, records: [] };
  const plants = await Plant.find({}).select('_id plantName').lean();
  return {
    message: sessions.length
      ? 'Plant entry and exit data from stored geofence sessions.'
      : 'Stored plant entry records found; corresponding exit data is not available.',
    records: sessions.map((session) => {
      const enteredAt = new Date(session.enteredAt);
      const exitedAt = session.exitedAt && new Date(session.exitedAt) <= range.end
        ? new Date(session.exitedAt)
        : null;
      const lastObservedAt = session.lastSeenAt && new Date(session.lastSeenAt) <= range.end
        ? new Date(session.lastSeenAt)
        : null;
      const durationEnd = exitedAt || lastObservedAt;
      const plant = plants.find((item) => String(item._id) === String(session.plantId));
      const isOutside = session.zoneId === 'OUTSIDE';
      return {
        vehicleNumber: session.vehicleNumber,
        plantId: session.plantId || null,
        plantName: plant?.plantName || null,
        zoneId: session.zoneId,
        enteredAt: session.enteredAt,
        exitedAt,
        entryGpsTimestamp: session.entryGpsTimestamp || null,
        exitGpsTimestamp: session.exitGpsTimestamp || null,
        provider: session.provider,
        dataSource: providerLabel(session.provider),
        stayHours: !isOutside && durationEnd
          ? msToHHMM(durationEnd.getTime() - enteredAt.getTime())
          : null,
        outsideHours: isOutside && durationEnd
          ? msToHHMM(durationEnd.getTime() - enteredAt.getTime())
          : null,
      };
    }),
    entriesWithoutSession: sessions.length ? [] : entries.map((entry) => ({
      vehicleNumber: entry.vehicleNumber,
      plantId: entry.plantId,
      plantName: entry.plantName,
      enteredAt: entry.entryDateTime,
      exitedAt: null,
      gpsTimestamp: entry.gpsTimestamp || null,
    })),
  };
}

async function getVehicleMovement({ vehicleNumber, provider, from, to, targetTime, dateError }) {
  const vehicle = await findRegisteredVehicle(vehicleNumber);
  if (!vehicle) return { message: NOT_REGISTERED_MESSAGE };
  if (dateError) return { message: dateError };
  const now = new Date();
  const range = targetTime
    ? validatePastRange({ targetTime }, now)
    : from || to
      ? validatePastRange({ from: from || to, to: to || now.toISOString() }, now)
    : { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now };
  if (range.error) return { message: range.error };

  const query = {
    vehicleId: vehicle._id,
    archived: { $ne: true },
    gpsTimestamp: { $gte: range.start, $lte: range.end },
  };
  if (targetTime) {
    query.gpsTimestamp = {
      $gte: new Date(range.end.getTime() - GPS_STALE_THRESHOLD_MS),
      $lte: range.end,
    };
  }
  if (provider === 'FLEETX') query.provider = /fleetx/i;
  if (provider === 'WHEELSEYE') query.provider = /wheels.?eye/i;
  const movementQuery = GpsHistory.find(query)
    .select('provider speed gpsTimestamp latitude longitude')
    .sort({ gpsTimestamp: targetTime ? -1 : 1 })
    .limit(targetTime ? 1 : MAX_HISTORY_RECORDS);
  const fixes = await movementQuery.lean();
  if (!fixes.length) return { message: UNAVAILABLE_MESSAGE, vehicleNumber: vehicle.vehicleNumber, records: [] };

  const stops = [];
  let stop = null;
  for (const fix of fixes) {
    const timestamp = new Date(fix.gpsTimestamp);
    const speed = Number(fix.speed);
    const hasSpeed = fix.speed !== null && fix.speed !== undefined && fix.speed !== '' && Number.isFinite(speed);
    if (hasSpeed && speed === 0) {
      if (stop && timestamp.getTime() - new Date(stop.lastFixAt).getTime() <= MAX_GPS_GAP_MS) {
        stop.lastFixAt = timestamp;
        stop.samples += 1;
      } else {
        if (stop) stops.push(stop);
        stop = {
          provider: fix.provider,
          startedAt: timestamp,
          lastFixAt: timestamp,
          samples: 1,
          latitude: fix.latitude,
          longitude: fix.longitude,
        };
      }
    } else if (stop) {
      stops.push(stop);
      stop = null;
    }
  }
  if (stop) stops.push(stop);
  const stoppages = stops.map((item) => ({
    ...item,
    endedAt: item.lastFixAt,
    durationMinutes: Math.max(0, Math.round((new Date(item.lastFixAt) - new Date(item.startedAt)) / 60000)),
  }));
  return {
    message: 'Movement and stoppage results are calculated only from stored GPS timestamps and speeds.',
    vehicleNumber: vehicle.vehicleNumber,
    from: range.start,
    to: range.end,
    fixCount: fixes.length,
    dataSource: providerLabel(fixes[fixes.length - 1].provider),
    lastGpsUpdateAt: fixes[fixes.length - 1].gpsTimestamp,
    movingFixes: fixes.filter((fix) => fix.speed !== null && fix.speed !== undefined && Number.isFinite(Number(fix.speed)) && Number(fix.speed) > 0).length,
    stoppedFixes: fixes.filter((fix) => fix.speed !== null && fix.speed !== undefined && Number.isFinite(Number(fix.speed)) && Number(fix.speed) === 0).length,
    unknownSpeedFixes: fixes.filter((fix) => fix.speed === null || fix.speed === undefined || fix.speed === '' || !Number.isFinite(Number(fix.speed))).length,
    stoppages: stoppages.slice(0, 250),
  };
}

async function getDailyReport({ vehicleNumber, from, to, targetTime, dateError }) {
  const vehicle = await findRegisteredVehicle(vehicleNumber);
  if (!vehicle) return { message: NOT_REGISTERED_MESSAGE };
  if (dateError) return { message: dateError };
  if (!from && !to && !targetTime) return { message: 'Specify a report date or date range.' };
  const now = new Date();
  const range = targetTime
    ? validatePastRange({ targetTime }, now)
    : validatePastRange({ from: from || to, to: to || from }, now);
  if (range.error) return { message: range.error };
  if (range.end.getTime() - range.start.getTime() > MAX_REPORT_DAYS * 24 * 60 * 60 * 1000) {
    return { message: `Report date ranges are limited to ${MAX_REPORT_DAYS} days.` };
  }
  const fromDate = istDateString(range.start);
  const toDate = istDateString(range.end);
  const [report, latestFix] = await Promise.all([
    generateFleetReport({
      fromDate,
      toDate,
      vehicleNumber: vehicle.vehicleNumber,
      persist: false,
    }),
    GpsHistory.findOne({
      vehicleId: vehicle._id,
      provider: /wheels.?eye/i,
      archived: { $ne: true },
      gpsTimestamp: { $gte: range.start, $lte: range.end },
    })
      .sort({ gpsTimestamp: -1 })
      .select('gpsTimestamp')
      .lean(),
  ]);
  if (!report.rows.length) {
    return { message: UNAVAILABLE_MESSAGE, vehicleNumber: vehicle.vehicleNumber, reports: [] };
  }
  return {
    message: `Date-wise report calculated from saved WheelsEye GPS records for ${vehicle.vehicleNumber}.`,
    vehicleNumber: vehicle.vehicleNumber,
    dataSource: 'WheelsEye',
    lastGpsUpdateAt: latestFix?.gpsTimestamp || null,
    reports: report.rows.map((row) => ({
      date: row.dateRaw,
      dasnaMinutes: row.dasnaMinutes,
      saltPlantMinutes: row.saltPlantMinutes,
      teaPlantMinutes: row.teaPlantMinutes,
      outsideMinutes: row.outsideMinutes,
      noGpsDataMinutes: row.noGpsDataMinutes,
      totalMinutes: row.totalMinutes,
      inProgress: row.inProgress,
    })),
  };
}

async function getVehiclePlans({ vehicleNumber }) {
  const vehicle = await findRegisteredVehicle(vehicleNumber);
  if (!vehicle) return { message: NOT_REGISTERED_MESSAGE };
  const status = await VehicleCurrentStatus.findOne({ vehicleId: vehicle._id })
    .select('plans')
    .lean();
  const plans = Array.isArray(status?.plans) ? status.plans : [];
  if (!plans.length) return { message: UNAVAILABLE_MESSAGE, vehicleNumber: vehicle.vehicleNumber, plans: [] };
  const now = new Date();
  return {
    message: 'Saved trip plans from Sikka Fleet.',
    vehicleNumber: vehicle.vehicleNumber,
    plans: plans.map((plan) => ({
      planText: plan.planText,
      planType: plan.planType,
      authorName: plan.authorName,
      createdAt: plan.createdAt,
      expiresAt: plan.expiresAt || null,
      active: plan.expiresAt ? new Date(plan.expiresAt) > now : true,
    })),
  };
}

async function getDriverStatus(user) {
  const driverId = user?.id || user?._id;
  const driver = driverId ? await Driver.findById(driverId).select(
    'driverName status currentStatus currentPlantName currentPlantInTime lastPlantOutTime lastLocation lastLocationUpdateAt locationDeductionStatus'
  ).lean() : null;
  if (!driver) return { message: UNAVAILABLE_MESSAGE };
  const [activePlantRecord, latestLocation] = await Promise.all([
    DriverPlantRecord.findOne({ driverId, status: 'Inside' })
      .select('plantName inTime inLatitude inLongitude status')
      .sort({ inTime: -1 })
      .lean(),
    DriverLocation.findOne({ driverId })
      .select('latitude longitude capturedAt accuracy')
      .sort({ capturedAt: -1 })
      .lean(),
  ]);
  return {
    message: `Your driver status, ${driver.driverName}, is shown from your own saved driver records.`,
    driverName: driver.driverName,
    status: driver.currentStatus,
    plantName: activePlantRecord?.plantName || driver.currentPlantName || null,
    plantEntryAt: activePlantRecord?.inTime || driver.currentPlantInTime || null,
    lastPlantExitAt: driver.lastPlantOutTime || null,
    location: latestLocation
      ? {
          latitude: latestLocation.latitude,
          longitude: latestLocation.longitude,
          gpsTimestamp: latestLocation.capturedAt,
          accuracyMeters: latestLocation.accuracy ?? null,
        }
      : driver.lastLocation,
    locationUpdatedAt: latestLocation?.capturedAt || driver.lastLocationUpdateAt || null,
    locationDeductionStatus: driver.locationDeductionStatus,
  };
}

async function getGpsSyncStatus({ provider }) {
  const settings = await GpsSetting.find({ archived: { $ne: true } })
    .select('provider connectionStatus lastSync lastSuccessAt last_evaluated_timestamp last_sync_status next_scheduled_sync_at lastError lastErrorCode vehicles_processed vehicles_updated vehicles_failed')
    .lean();
  const providerNames = provider
    ? [provider === 'FLEETX' ? 'FleetX' : 'WheelsEye GPS']
    : ['WheelsEye GPS', 'FleetX'];
  const now = new Date();
  const nextSync = require('./gpsSyncService').getNextFixed30MinSlotIST(now);
  const syncResults = await Promise.all(providerNames.map(async (providerName) => {
    const setting = settings.find((item) => item.provider === providerName);
    const providerQuery = {
      provider: new RegExp(providerName === 'FleetX' ? 'fleetx' : 'wheels.?eye', 'i'),
      archived: { $ne: true },
    };
    const [latestLog, lastSuccessfulLog] = await Promise.all([
      GpsSyncLog.findOne(providerQuery)
        .sort({ startedAt: -1 })
        .select('status startedAt completedAt vehiclesUpdated vehiclesFailed errorMessage')
        .lean(),
      GpsSyncLog.findOne({ ...providerQuery, status: { $in: ['SUCCESS', 'PARTIAL'] } })
        .sort({ completedAt: -1 })
        .select('completedAt')
        .lean(),
    ]);
    return {
      provider: providerName,
      configured: Boolean(setting),
      connectionStatus: setting?.connectionStatus || 'Not configured',
      syncStatus: latestLog?.status || setting?.last_sync_status || 'IDLE',
      lastSyncAt: setting?.lastSuccessAt || lastSuccessfulLog?.completedAt || null,
      nextScheduledSyncAt: setting?.next_scheduled_sync_at && new Date(setting.next_scheduled_sync_at) > now
        ? setting.next_scheduled_sync_at
        : nextSync,
      lastAttemptAt: latestLog?.completedAt || latestLog?.startedAt || setting?.lastSync || null,
      vehiclesProcessed: setting?.vehicles_processed || 0,
      vehiclesUpdated: setting?.vehicles_updated ?? latestLog?.vehiclesUpdated ?? 0,
      vehiclesFailed: setting?.vehicles_failed ?? latestLog?.vehiclesFailed ?? 0,
      hasError: Boolean(setting?.lastError || latestLog?.errorMessage),
      lastErrorCode: setting?.lastErrorCode || '',
    };
  }));
  return {
    message: 'GPS sync status from Sikka Fleet provider settings and sync logs.',
    providers: syncResults,
  };
}

async function syncProviders(user, provider = null, vehicleNumber = null) {
  if (user?.role !== 'Admin') {
    const error = new Error('Only administrators can start GPS synchronization from Sikka AI.');
    error.code = 'ADMIN_REQUIRED';
    throw error;
  }
  const { syncBothGpsProviders, syncProviderGps } = require('./gpsSyncEngine');
  const caller = `Sikka AI: ${user.username || 'Admin'}`;
  let results;
  if (!provider) {
    results = await syncBothGpsProviders({ mode: 'MANUAL', caller });
  } else {
    const key = provider === 'FLEETX' ? 'fleetx' : 'wheelseye';
    const providerName = provider === 'FLEETX' ? 'FLEETX' : 'WHEELSEYE';
    try {
      results = { [key]: await syncProviderGps({ provider: providerName, mode: 'MANUAL', caller }) };
    } catch (error) {
      results = { [key]: { success: false, status: 'FAILED', errorCode: getSafeSyncErrorCode(error) } };
    }
  }
  const normalized = (result) => {
    const savedCount = Number(result.savedCount ?? result.successCount ?? 0);
    return {
      status: result.status || (result.failedCount > 0
        ? savedCount > 0 ? 'PARTIAL' : 'FAILED'
        : result.success ? 'SUCCESS' : 'FAILED'),
      totalVehicles: Number(result.totalVehicles || 0),
      receivedCount: Number(result.receivedCount || 0),
      matchedCount: Number(result.matchedCount || 0),
      savedCount,
      unchangedCount: Number(result.unchangedCount || 0),
      successCount: savedCount,
      failedCount: Number(result.failedCount || 0),
      failureReasons: result.failureReasons || {},
      errorCode: result.errorCode || null,
      completedAt: new Date().toISOString(),
    };
  };
  return Object.fromEntries(Object.entries(results).map(([key, result]) => [key, normalized(result)]));
}

async function executeToolCall(call, user) {
  const args = call?.args && typeof call.args === 'object' && !Array.isArray(call.args) ? call.args : {};
  switch (call?.name) {
    case 'get_vehicle_location':
      return getCurrentVehicleLocation(args);
    case 'get_vehicle_details':
      return getCurrentVehicleLocation(args);
    case 'get_vehicle_history':
      return getVehicleHistory(args);
    case 'get_registered_vehicles':
      return getRegisteredVehicles();
    case 'get_vehicle_movement':
      return getVehicleMovement(args);
    case 'get_daily_report':
      return getDailyReport(args);
    case 'get_vehicle_plans':
      return getVehiclePlans(args);
    case 'get_driver_status':
      return getDriverStatus(user);
    case 'request_vehicle_number':
      return { message: 'Please include the exact registered vehicle number.' };
    case 'get_plant_availability':
      return getPlantAvailability(args);
    case 'get_fleet_status':
      return getPlantAvailability({ includeVehicles: false });
    case 'get_plant_movements':
      return getPlantMovements(args);
    case 'sync_gps_now':
      return syncProviders(user, args.provider);
    case 'sync_then_location': {
      const syncResults = await syncProviders(user, args.provider, args.vehicleNumber);
      const location = args.vehicleNumber
        ? await getCurrentVehicleLocation({ vehicleNumber: args.vehicleNumber, provider: args.provider })
        : await getRegisteredVehicles();
      return { message: 'GPS sync attempt finished; the returned location is read from saved Sikka Fleet records.', syncResults, location };
    }
    case 'get_gps_sync_status':
      return getGpsSyncStatus(args);
    case 'future_refusal':
      return { message: FUTURE_DATA_MESSAGE };
    case 'invalid_date':
      return { message: args.message || 'Use a valid past date.' };
    case 'clarify_date':
      return {
        message: 'Please choose whether you mean yesterday or tomorrow.',
        clarification: args.dateTerm,
      };
    default: {
      return { message: UNSUPPORTED_MESSAGE, unsupported: true };
    }
  }
}

function formatToolAnswer(results, language = 'en') {
  const result = results[results.length - 1];
  if (!result) return UNSUPPORTED_MESSAGE;
  const data = result.data || {};
  const location = data.location && typeof data.location === 'object' ? data.location : data;
  const isVehicleLocation = Boolean(
    ['get_vehicle_location', 'get_vehicle_details'].includes(result.tool) &&
    location.vehicleNumber &&
    location.gpsTimestamp
  );
  let answer = data.message || 'Verified database results are shown below.';
  if (result.tool === 'future_refusal') {
    answer = localize(
      language,
      FUTURE_DATA_MESSAGE,
      'भविष्य की वाहन लोकेशन उपलब्ध नहीं है। Sikka AI केवल वर्तमान और पुराने रिकॉर्ड दिखाता है।',
      'Future vehicle location available nahi hai. Sikka AI sirf current aur purane records dikhata hai.'
    );
  } else if (isVehicleLocation) {
    const updateTime = formatLocationTimestamp(location.gpsTimestamp);
    const place = location.plantStatus === 'Inside'
      ? location.plantName || UNAVAILABLE_MESSAGE
      : location.location || UNAVAILABLE_MESSAGE;
    const compactAnswer = language === 'hi'
      ? `अंतिम अपडेट: ${updateTime}\nवाहन: ${location.vehicleNumber}\nलोकेशन: ${place}`
      : `Last Update: ${updateTime}\nVehicle: ${location.vehicleNumber}\nLocation: ${place}`;
    if (result.tool === 'get_vehicle_location') {
      answer = compactAnswer;
    } else {
      const details = language === 'hi'
        ? [
            `स्रोत: ${location.dataSource || providerLabel(location.provider)}`,
            `गति: ${location.speed ?? 'record not available'}`,
            `Ignition: ${location.ignition ?? 'record not available'}`,
            `निर्देशांक: ${location.latitude}, ${location.longitude}`,
            `प्लांट में समय: ${location.stayHours || 'record not available'}`,
            `बाहर का समय: ${location.outsideHours || 'record not available'}`,
          ]
        : [
            `Source: ${location.dataSource || providerLabel(location.provider)}`,
            `Speed: ${location.speed ?? 'record not available'}`,
            `Ignition: ${location.ignition ?? 'record not available'}`,
            `Coordinates: ${location.latitude}, ${location.longitude}`,
            `Plant stay: ${location.stayHours || 'record not available'}`,
            `Outside hours: ${location.outsideHours || 'record not available'}`,
          ];
      answer = `${compactAnswer}\n\n${details.join('\n')}`;
    }
  } else if (['get_vehicle_location', 'get_vehicle_details'].includes(result.tool)) {
    answer = data.message === NOT_REGISTERED_MESSAGE
      ? NOT_REGISTERED_MESSAGE
      : UNAVAILABLE_MESSAGE;
  } else if (result.tool === 'sync_gps_now') {
    answer = localize(language, 'GPS sync finished. See More details for provider results.', 'GPS sync पूरा हुआ। Provider नतीजों के लिए More details देखें।', 'GPS sync complete hua. Provider results ke liye More details dekhein.');
  } else if (result.tool === 'get_plant_availability') {
    const availability = data.plantAvailability || [];
    answer = availability.length
      ? availability.map((plant) =>
          localize(language,
            `${plant.plantName}: ${plant.inside} inside`,
            `${plant.plantName}: ${plant.inside} अंदर`,
            `${plant.plantName}: ${plant.inside} andar`
          )
        ).join('; ')
      : data.plant
        ? localize(language,
            `${data.plant.plantName}: ${data.plant.inside} inside.`,
            `${data.plant.plantName}: ${data.plant.inside} अंदर।`,
            `${data.plant.plantName}: ${data.plant.inside} andar.`
          )
        : data.message || answer;
    if (Array.isArray(data.vehicles) && data.vehicles.length) {
      answer += ` Vehicles: ${data.vehicles.map((vehicle) =>
        `${vehicle.vehicleNumber} (${vehicle.dataSource}, ${formatIstTimestamp(vehicle.gpsTimestamp)})`
      ).join('; ')}.`;
    }
  } else if (result.tool === 'get_fleet_status' && data.totals) {
    const totals = data.totals;
    answer = `Vehicles: ${totals.registered}; inside: ${totals.inside}; outside: ${totals.outside}; GPS unknown: ${totals.unknown}; moving: ${totals.moving}; stopped: ${totals.stopped}; ignition on: ${totals.ignitionOn}; ignition off: ${totals.ignitionOff}. Last GPS update: ${formatIstTimestamp(data.lastGpsUpdateAt)} (Asia/Kolkata).`;
  } else if (result.tool === 'get_gps_sync_status' && Array.isArray(data.providers)) {
    answer = data.providers.map((provider) =>
      `${provider.provider}: ${provider.syncStatus}; connection ${provider.connectionStatus}; last sync ${formatIstTimestamp(provider.lastSyncAt)}; next scheduled ${formatIstTimestamp(provider.nextScheduledSyncAt)} (Asia/Kolkata)`
    ).join('\n');
  } else if (result.tool === 'get_registered_vehicles' && Array.isArray(data.vehicles)) {
    answer = `${data.count} active registered vehicles. ` + data.vehicles.slice(0, 25).map((vehicle) =>
      `${vehicle.vehicleNumber}: ${vehicle.plantStatus}; ${vehicle.dataSource}; last GPS ${formatIstTimestamp(vehicle.gpsTimestamp)}`
    ).join('; ');
    if (data.vehicles.length > 25) answer += `; and ${data.vehicles.length - 25} more.`;
  } else if (result.tool === 'get_plant_movements') {
    const storedRecords = [
      ...(Array.isArray(data.records) ? data.records : []),
      ...(Array.isArray(data.entriesWithoutSession) ? data.entriesWithoutSession : []),
    ];
    if (storedRecords.length) {
      answer = storedRecords.slice(0, 25).map((record) => {
        const eventTime = formatIstTimestamp(record.enteredAt);
        const exitTime = formatIstTimestamp(record.exitedAt);
        return `${record.vehicleNumber}: ${record.plantName || (record.zoneId === 'OUTSIDE' ? 'Outside' : 'Plant')}; entry ${eventTime}; exit ${exitTime}; source ${record.dataSource || providerLabel(record.provider)}; plant stay ${record.stayHours || 'record not available'}; outside ${record.outsideHours || 'record not available'}`;
      }).join('\n');
      if (storedRecords.length > 25) answer += `\nAnd ${storedRecords.length - 25} more saved event(s).`;
    }
  } else if (result.tool === 'get_vehicle_movement' && Array.isArray(data.stoppages)) {
    answer = `${data.vehicleNumber}: ${data.fixCount} saved GPS fix(es); moving ${data.movingFixes}, stopped ${data.stoppedFixes}, speed unknown ${data.unknownSpeedFixes}; source ${data.dataSource || 'record not available'}; last GPS update ${formatIstTimestamp(data.lastGpsUpdateAt)} (Asia/Kolkata).`;
    if (data.stoppages.length) {
      answer += ` Stoppages: ${data.stoppages.slice(0, 10).map((stop) =>
        `${formatIstTimestamp(stop.startedAt)}–${formatIstTimestamp(stop.endedAt)} (${stop.durationMinutes} min)`
      ).join('; ')}.`;
    }
  } else if (result.tool === 'get_daily_report' && Array.isArray(data.reports)) {
    answer = data.reports.map((report) =>
      language === 'en'
        ? `${report.date}: Salt ${msToHHMM(report.saltPlantMinutes * 60000)}, Tea ${msToHHMM(report.teaPlantMinutes * 60000)}, DASNA ${msToHHMM(report.dasnaMinutes * 60000)}, Outside ${msToHHMM(report.outsideMinutes * 60000)}, No GPS ${msToHHMM(report.noGpsDataMinutes * 60000)} (total ${msToHHMM(report.totalMinutes * 60000)})`
        : localize(language,
            `${report.date}: Salt ${msToHHMM(report.saltPlantMinutes * 60000)}, Tea ${msToHHMM(report.teaPlantMinutes * 60000)}, DASNA ${msToHHMM(report.dasnaMinutes * 60000)}, Outside ${msToHHMM(report.outsideMinutes * 60000)}, No GPS ${msToHHMM(report.noGpsDataMinutes * 60000)} (total ${msToHHMM(report.totalMinutes * 60000)})`,
            `${report.date}: Salt ${msToHHMM(report.saltPlantMinutes * 60000)}, Tea ${msToHHMM(report.teaPlantMinutes * 60000)}, DASNA ${msToHHMM(report.dasnaMinutes * 60000)}, बाहर ${msToHHMM(report.outsideMinutes * 60000)}, GPS रिकॉर्ड नहीं ${msToHHMM(report.noGpsDataMinutes * 60000)} (कुल ${msToHHMM(report.totalMinutes * 60000)})`,
            `${report.date}: Salt ${msToHHMM(report.saltPlantMinutes * 60000)}, Tea ${msToHHMM(report.teaPlantMinutes * 60000)}, DASNA ${msToHHMM(report.dasnaMinutes * 60000)}, Outside ${msToHHMM(report.outsideMinutes * 60000)}, GPS record nahi ${msToHHMM(report.noGpsDataMinutes * 60000)} (total ${msToHHMM(report.totalMinutes * 60000)})`)
    ).join('\n');
    answer += localize(
      language,
      ` Source: ${data.dataSource || 'WheelsEye'}; last GPS update: ${formatIstTimestamp(data.lastGpsUpdateAt)} (Asia/Kolkata).`,
      ` स्रोत: ${data.dataSource || 'WheelsEye'}; अंतिम GPS अपडेट: ${formatIstTimestamp(data.lastGpsUpdateAt)} (Asia/Kolkata)।`,
      ` Source: ${data.dataSource || 'WheelsEye'}; last GPS update: ${formatIstTimestamp(data.lastGpsUpdateAt)} (Asia/Kolkata).`
    );
  } else if (result.tool === 'get_vehicle_history' && Array.isArray(data.records) && data.records.length) {
    const records = data.records.slice(0, 5).map((record) =>
      `${record.dataSource || providerLabel(record.provider)} ${formatIstTimestamp(record.gpsTimestamp)} (${record.plantStatus?.plantName || record.location || UNAVAILABLE_MESSAGE})`
    ).join('; ');
    answer = localize(
      language,
      `**${data.vehicleNumber}** — ${data.records.length} saved GPS record(s): ${records}`,
      `**${data.vehicleNumber}** — ${data.records.length} saved GPS record: ${records}`,
      `**${data.vehicleNumber}** — ${data.records.length} saved GPS records: ${records}`
    );
    if (data.records.length > 5) {
      answer += localize(language, `; and ${data.records.length - 5} more.`, `; और ${data.records.length - 5} रिकॉर्ड।`, `; aur ${data.records.length - 5} records.`);
    }
  }
  return answer;
}

function getSyncNotice(results, language = 'en') {
  const result = results?.[results.length - 1];
  const data = result?.data || {};
  if (data.aiSyncCooldown) {
    return localize(
      language,
      'Live sync skipped. Showing the saved update.',
      'लाइव सिंक नहीं किया गया। सेव्ड अपडेट दिखा रहे हैं।',
      'Live sync skip hua. Saved update dikha rahe hain.'
    );
  }
  const syncResults = data.syncResults || (result?.tool === 'sync_gps_now' ? data : null);
  if (!syncResults) return null;
  const failedProviders = Object.entries(syncResults)
    .filter(([name, provider]) =>
      /wheel|fleetx/i.test(name) && ['FAILED', 'PARTIAL'].includes(provider?.status)
    )
    .map(([name]) => name.toLowerCase().includes('wheel') ? 'WheelsEye' : 'FleetX');
  if (!failedProviders.length) return null;
  const providers = [...new Set(failedProviders)].join(' and ');
  return localize(
    language,
    `Live sync failed${providers ? ` (${providers})` : ''}. Showing last saved update.`,
    `लाइव सिंक${providers ? ` (${providers})` : ''} नहीं हुआ। आखिरी सेव्ड अपडेट दिखा रहे हैं।`,
    `Live sync${providers ? ` (${providers})` : ''} fail hua. Aakhri saved update dikha rahe hain.`
  );
}

module.exports = {
  FUTURE_DATA_MESSAGE,
  UNAVAILABLE_MESSAGE,
  NOT_REGISTERED_MESSAGE,
  UNSUPPORTED_MESSAGE,
  hashQuery,
  parseDateBoundary,
  validatePastRange,
  extractDateRange,
  extractVehicleToken,
  resolveVehicleReference,
  gpsIsFresh,
  getSuggestions,
  localize,
  hasFuzzyKeyword,
  recognizeQuestion,
  needsAiGpsSync,
  executeToolCall,
  formatToolAnswer,
  getSyncNotice,
};
