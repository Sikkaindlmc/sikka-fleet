const Plant = require('../models/Plant');
const Vehicle = require('../models/Vehicle');
const VehicleLocation = require('../models/VehicleLocation');
const PlantEntry = require('../models/PlantEntry');
const VehicleCurrentStatus = require('../models/VehicleCurrentStatus');
const Driver = require('../models/Driver');
const DriverLocation = require('../models/DriverLocation');
const DriverPlantRecord = require('../models/DriverPlantRecord');
const { calculateHaversineDistance } = require('./geofenceService');

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format YYYY-MM-DD string into 'DD-MMM-YYYY' (e.g. '01-Oct-2026')
 */
function formatDisplayDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  const monthIdx = parseInt(month, 10) - 1;
  return `${day.padStart(2, '0')}-${MONTHS_SHORT[monthIdx] || 'Jan'}-${year}`;
}

/**
 * Converts milliseconds to 'HH:MM' string format
 */
function msToHHMM(ms) {
  if (!ms || ms <= 0) return '00:00';
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Normalize plant name into standard report column categories
 * Salt Plant | Tea Plant | Dasna Plant | null
 */
function getPlantCategory(plantName) {
  if (!plantName) return null;
  const lower = plantName.toString().toLowerCase();
  if (lower.includes('salt')) return 'Salt Plant';
  if (lower.includes('tea')) return 'Tea Plant';
  if (lower.includes('dasna')) return 'Dasna Plant';
  return null;
}

/**
 * Generate array of all YYYY-MM-DD date strings between fromDateStr and toDateStr inclusive
 */
function generateDateList(fromDateStr, toDateStr) {
  const dates = [];
  const [y1, m1, d1] = fromDateStr.split('-').map(Number);
  const [y2, m2, d2] = toDateStr.split('-').map(Number);

  const current = new Date(Date.UTC(y1, m1 - 1, d1));
  const end = new Date(Date.UTC(y2, m2 - 1, d2));

  while (current <= end) {
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, '0');
    const d = String(current.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Parse YYYY-MM-DD into start and end of day in Indian Standard Time (UTC+5:30)
 */
function parseISTDayRange(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  // IST is UTC+5:30 -> 00:00:00 IST is previous UTC day 18:30:00
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const startOfDayUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - istOffsetMs);
  const endOfDayUtc = new Date(startOfDayUtc.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start: startOfDayUtc, end: endOfDayUtc };
}

/**
 * Segment-flattening interval normalizer:
 * Takes raw candidate intervals (plant stays and outside movements) and flattens them
 * into non-overlapping disjoint segments where Plant Stays have strict priority over Outside.
 * Prevents double-counting, prevents overlapping, and ensures mutual exclusivity.
 */
function normalizeIntervals(rawIntervals) {
  const valid = rawIntervals
    .filter((inv) => inv.start && inv.end && inv.end.getTime() > inv.start.getTime())
    .map((inv) => ({
      start: inv.start.getTime(),
      end: inv.end.getTime(),
      state: inv.state,
    }));

  if (valid.length === 0) return [];

  // Extract all boundary timestamps
  const timestamps = Array.from(
    new Set(valid.flatMap((i) => [i.start, i.end]))
  ).sort((a, b) => a - b);

  const segments = [];

  for (let k = 0; k < timestamps.length - 1; k++) {
    const sStart = timestamps[k];
    const sEnd = timestamps[k + 1];
    if (sEnd <= sStart) continue;

    // Find all raw intervals that cover this segment
    const covering = valid.filter((i) => i.start <= sStart && i.end >= sEnd);
    if (covering.length === 0) continue;

    // Priority: Plant stay always takes priority over 'Outside'
    const plantStay = covering.find((i) => i.state !== 'Outside');
    const chosenState = plantStay ? plantStay.state : 'Outside';

    // Merge with previous segment if state is identical
    const last = segments[segments.length - 1];
    if (last && last.state === chosenState && last.end === sStart) {
      last.end = sEnd;
    } else {
      segments.push({
        start: sStart,
        end: sEnd,
        state: chosenState,
      });
    }
  }

  return segments;
}

/**
 * Calculates total duration for each state within a specific day [D_start, D_end]
 * Automatically handles stays crossing midnight by slicing to the day boundaries.
 */
function computeDailyDurations(normalizedSegments, dayStart, dayEnd) {
  const dStart = dayStart.getTime();
  const dEnd = dayEnd.getTime();

  const totals = {
    'Salt Plant': 0,
    'Tea Plant': 0,
    'Dasna Plant': 0,
    Outside: 0,
  };

  for (const seg of normalizedSegments) {
    const oStart = Math.max(seg.start, dStart);
    const oEnd = Math.min(seg.end, dEnd);

    if (oEnd > oStart) {
      const durationMs = oEnd - oStart;
      if (totals[seg.state] !== undefined) {
        totals[seg.state] += durationMs;
      } else {
        totals.Outside += durationMs;
      }
    }
  }

  return {
    saltStay: msToHHMM(totals['Salt Plant']),
    teaStay: msToHHMM(totals['Tea Plant']),
    dasnaStay: msToHHMM(totals['Dasna Plant']),
    outsideTotal: msToHHMM(totals.Outside),
  };
}

/**
 * Generate Fleet Report for all vehicles across specified date range
 */
async function generateFleetReport({ fromDate, toDate, vehicleNumber }) {
  if (!fromDate || !toDate) {
    throw new Error('From Date and To Date are mandatory.');
  }

  if (fromDate > toDate) {
    throw new Error('From Date cannot be later than To Date.');
  }

  const dateList = generateDateList(fromDate, toDate);
  const activePlants = await Plant.find({ status: 'Active' });

  // Map plants to categories and radius
  const plantConfigs = activePlants.map((p) => ({
    name: p.plantName,
    category: getPlantCategory(p.plantName),
    latitude: p.latitude,
    longitude: p.longitude,
    radius: p.radiusMeters || p.radiusMeter || 500,
  })).filter((p) => p.category !== null);

  const determinePlantState = (lat, lon) => {
    if (typeof lat !== 'number' || typeof lon !== 'number') return 'Outside';
    for (const p of plantConfigs) {
      const dist = calculateHaversineDistance(lat, lon, p.latitude, p.longitude);
      if (dist <= p.radius) {
        return p.category;
      }
    }
    return 'Outside';
  };

  // Find target vehicles
  const vehicleQuery = { status: 'Active' };
  if (vehicleNumber && vehicleNumber !== 'ALL') {
    vehicleQuery.vehicleNumber = vehicleNumber.trim().toUpperCase();
  }

  let vehicles = await Vehicle.find(vehicleQuery).sort({ vehicleNumber: 1 });
  if (vehicles.length === 0 && (!vehicleNumber || vehicleNumber === 'ALL')) {
    vehicles = await Vehicle.find().sort({ vehicleNumber: 1 });
  }

  const overallStart = parseISTDayRange(dateList[0]).start;
  const overallEnd = parseISTDayRange(dateList[dateList.length - 1]).end;

  const rows = [];

  for (const v of vehicles) {
    const vNum = v.vehicleNumber;
    const vId = v._id;

    // Fetch chronological vehicle movement records
    const [locations, plantEntries, currentStatus] = await Promise.all([
      VehicleLocation.find({
        vehicleNumber: vNum,
        gpsDateTime: { $gte: new Date(overallStart.getTime() - 24 * 3600 * 1000), $lte: new Date(overallEnd.getTime() + 24 * 3600 * 1000) },
      }).sort({ gpsDateTime: 1 }),
      PlantEntry.find({
        vehicleNumber: vNum,
        entryDateTime: { $gte: new Date(overallStart.getTime() - 24 * 3600 * 1000), $lte: new Date(overallEnd.getTime() + 24 * 3600 * 1000) },
      }).sort({ entryDateTime: 1 }),
      VehicleCurrentStatus.findOne({ vehicleId: vId }),
    ]);

    // Build timeline points
    const points = [];

    for (const loc of locations) {
      const state = determinePlantState(loc.latitude, loc.longitude);
      points.push({
        time: new Date(loc.gpsDateTime || loc.receivedAt),
        state,
      });
    }

    // Explicit plant visits from PlantEntry
    const explicitVisits = [];
    for (let i = 0; i < plantEntries.length; i++) {
      const pe = plantEntries[i];
      const category = getPlantCategory(pe.plantName);
      if (!category) continue;

      const entryTime = new Date(pe.entryDateTime);
      // Find when the vehicle exited or moved to another point
      let exitTime = null;
      const nextPe = plantEntries[i + 1];
      if (nextPe) {
        exitTime = new Date(nextPe.entryDateTime);
      }

      // Check subsequent location points
      const nextOutsidePoint = points.find(
        (pt) => pt.time > entryTime && pt.state === 'Outside'
      );
      if (nextOutsidePoint) {
        if (!exitTime || nextOutsidePoint.time < exitTime) {
          exitTime = nextOutsidePoint.time;
        }
      }

      // If still inside current plant
      if (!exitTime) {
        if (currentStatus && currentStatus.status === 'Inside' && currentStatus.currentPlantId?.toString() === pe.plantId?.toString()) {
          exitTime = new Date(Math.min(Date.now(), overallEnd.getTime()));
        } else if (currentStatus?.lastExitDateTime) {
          exitTime = new Date(currentStatus.lastExitDateTime);
        } else {
          // Default visit length if single ping
          exitTime = new Date(entryTime.getTime() + 30 * 60 * 1000);
        }
      }

      if (exitTime > entryTime) {
        explicitVisits.push({
          start: entryTime,
          end: exitTime,
          plantKey: category,
        });
      }
    }

    // Add current live stay if inside
    if (currentStatus && currentStatus.status === 'Inside' && currentStatus.lastEntryDateTime) {
      const cPlant = activePlants.find((p) => p._id.toString() === currentStatus.currentPlantId?.toString());
      const cat = cPlant ? getPlantCategory(cPlant.plantName) : null;
      if (cat) {
        explicitVisits.push({
          start: new Date(currentStatus.lastEntryDateTime),
          end: new Date(Math.min(Date.now(), overallEnd.getTime())),
          plantKey: cat,
        });
      }
    }

    // Create candidate intervals from continuous points
    const candidateIntervals = [];

    for (const ev of explicitVisits) {
      candidateIntervals.push({
        start: ev.start,
        end: ev.end,
        state: ev.plantKey,
      });
    }

    // Sequence chronological GPS pings
    const sortedPoints = points.slice().sort((a, b) => a.time - b.time);
    for (let i = 0; i < sortedPoints.length - 1; i++) {
      const ptA = sortedPoints[i];
      const ptB = sortedPoints[i + 1];
      const tA = ptA.time.getTime();
      const tB = ptB.time.getTime();
      const diffMs = tB - tA;

      if (diffMs <= 0) continue;

      const MAX_PING_GAP = 2 * 3600 * 1000; // 2 hours
      if (diffMs <= MAX_PING_GAP) {
        if (ptA.state === ptB.state) {
          candidateIntervals.push({
            start: ptA.time,
            end: ptB.time,
            state: ptA.state,
          });
        } else {
          const mid = new Date(tA + Math.floor(diffMs / 2));
          candidateIntervals.push({ start: ptA.time, end: mid, state: ptA.state });
          candidateIntervals.push({ start: mid, end: ptB.time, state: ptB.state });
        }
      } else {
        // Gap > 2 hours: if inside same plant, vehicle parked
        if (ptA.state === ptB.state && ptA.state !== 'Outside') {
          candidateIntervals.push({ start: ptA.time, end: ptB.time, state: ptA.state });
        } else {
          candidateIntervals.push({
            start: ptA.time,
            end: new Date(tA + Math.min(15 * 60 * 1000, diffMs / 2)),
            state: ptA.state,
          });
          candidateIntervals.push({
            start: new Date(tB - Math.min(15 * 60 * 1000, diffMs / 2)),
            end: ptB.time,
            state: ptB.state,
          });
        }
      }
    }

    // Normalize into disjoint non-overlapping segments
    const normalized = normalizeIntervals(candidateIntervals);

    // Generate output row for every date in range
    for (const dStr of dateList) {
      const dayRange = parseISTDayRange(dStr);
      const durations = computeDailyDurations(normalized, dayRange.start, dayRange.end);

      rows.push({
        vehicleNumber: vNum,
        date: formatDisplayDate(dStr),
        dateRaw: dStr,
        saltPlantStay: durations.saltStay,
        teaPlantStay: durations.teaStay,
        dasnaPlantStay: durations.dasnaStay,
        outsideTotal: durations.outsideTotal,
      });
    }
  }

  return {
    reportType: 'Fleet',
    dateRange: { fromDate, toDate, displayFrom: formatDisplayDate(fromDate), displayTo: formatDisplayDate(toDate) },
    totalVehicles: vehicles.length,
    totalRecords: rows.length,
    rows,
  };
}

/**
 * Generate Drivers Report for all drivers across specified date range
 */
async function generateDriverReport({ fromDate, toDate, driverId }) {
  if (!fromDate || !toDate) {
    throw new Error('From Date and To Date are mandatory.');
  }

  if (fromDate > toDate) {
    throw new Error('From Date cannot be later than To Date.');
  }

  const dateList = generateDateList(fromDate, toDate);
  const activePlants = await Plant.find({ status: 'Active' });

  const plantConfigs = activePlants.map((p) => ({
    name: p.plantName,
    category: getPlantCategory(p.plantName),
    latitude: p.latitude,
    longitude: p.longitude,
    radius: p.radiusMeters || p.radiusMeter || 500,
  })).filter((p) => p.category !== null);

  const determinePlantState = (lat, lon) => {
    if (typeof lat !== 'number' || typeof lon !== 'number') return 'Outside';
    for (const p of plantConfigs) {
      const dist = calculateHaversineDistance(lat, lon, p.latitude, p.longitude);
      if (dist <= p.radius) {
        return p.category;
      }
    }
    return 'Outside';
  };

  // Find target drivers
  const driverQuery = { status: 'Active' };
  if (driverId && driverId !== 'ALL') {
    driverQuery.$or = [{ _id: driverId }, { dlNumber: driverId.trim().toUpperCase() }];
  }

  let drivers = await Driver.find(driverQuery).sort({ driverName: 1 });
  if (drivers.length === 0 && (!driverId || driverId === 'ALL')) {
    drivers = await Driver.find().sort({ driverName: 1 });
  }

  const overallStart = parseISTDayRange(dateList[0]).start;
  const overallEnd = parseISTDayRange(dateList[dateList.length - 1]).end;

  const rows = [];

  for (const drv of drivers) {
    const dId = drv._id;

    // Fetch chronological driver movement and plant records
    const [plantRecords, locations] = await Promise.all([
      DriverPlantRecord.find({
        driverId: dId,
        inTime: { $gte: new Date(overallStart.getTime() - 24 * 3600 * 1000), $lte: new Date(overallEnd.getTime() + 24 * 3600 * 1000) },
      }).sort({ inTime: 1 }),
      DriverLocation.find({
        driverId: dId,
        capturedAt: { $gte: new Date(overallStart.getTime() - 24 * 3600 * 1000), $lte: new Date(overallEnd.getTime() + 24 * 3600 * 1000) },
      }).sort({ capturedAt: 1 }),
    ]);

    const candidateIntervals = [];

    // 1. Process explicit DriverPlantRecord visits
    for (const pr of plantRecords) {
      const cat = getPlantCategory(pr.plantName);
      if (!cat) continue;

      const inTime = new Date(pr.inTime);
      let outTime = pr.outTime ? new Date(pr.outTime) : null;

      if (!outTime) {
        if (pr.status === 'Inside') {
          outTime = new Date(Math.min(Date.now(), overallEnd.getTime()));
        } else {
          outTime = new Date(inTime.getTime() + 30 * 60 * 1000);
        }
      }

      if (outTime > inTime) {
        candidateIntervals.push({
          start: inTime,
          end: outTime,
          state: cat,
        });
      }
    }

    // 2. Add current driver status if inside a plant
    if (drv.currentStatus === 'Inside' && drv.currentPlantInTime) {
      const cat = getPlantCategory(drv.currentPlantName);
      if (cat) {
        candidateIntervals.push({
          start: new Date(drv.currentPlantInTime),
          end: new Date(Math.min(Date.now(), overallEnd.getTime())),
          state: cat,
        });
      }
    }

    // 3. Process DriverLocation periodic pings (outside and plant movements)
    const points = locations.map((loc) => {
      let state = 'Outside';
      if (loc.currentStatus === 'Inside' && loc.plantName) {
        state = getPlantCategory(loc.plantName) || 'Outside';
      } else if (loc.latitude && loc.longitude) {
        state = determinePlantState(loc.latitude, loc.longitude);
      }
      return {
        time: new Date(loc.capturedAt),
        state,
      };
    }).sort((a, b) => a.time - b.time);

    for (let i = 0; i < points.length - 1; i++) {
      const ptA = points[i];
      const ptB = points[i + 1];
      const tA = ptA.time.getTime();
      const tB = ptB.time.getTime();
      const diffMs = tB - tA;

      if (diffMs <= 0) continue;

      const MAX_DRIVER_GAP = 2 * 3600 * 1000;
      if (diffMs <= MAX_DRIVER_GAP) {
        if (ptA.state === ptB.state) {
          candidateIntervals.push({ start: ptA.time, end: ptB.time, state: ptA.state });
        } else {
          const mid = new Date(tA + Math.floor(diffMs / 2));
          candidateIntervals.push({ start: ptA.time, end: mid, state: ptA.state });
          candidateIntervals.push({ start: mid, end: ptB.time, state: ptB.state });
        }
      }
    }

    // Normalize into disjoint non-overlapping segments
    const normalized = normalizeIntervals(candidateIntervals);

    // Generate output row for every date in range
    for (const dStr of dateList) {
      const dayRange = parseISTDayRange(dStr);
      const durations = computeDailyDurations(normalized, dayRange.start, dayRange.end);

      rows.push({
        driverName: drv.driverName,
        dlNumber: drv.dlNumber,
        mobileNumber: drv.mobileNumber,
        date: formatDisplayDate(dStr),
        dateRaw: dStr,
        saltPlantStay: durations.saltStay,
        teaPlantStay: durations.teaStay,
        dasnaPlantStay: durations.dasnaStay,
        outsideTotal: durations.outsideTotal,
      });
    }
  }

  return {
    reportType: 'Drivers',
    dateRange: { fromDate, toDate, displayFrom: formatDisplayDate(fromDate), displayTo: formatDisplayDate(toDate) },
    totalDrivers: drivers.length,
    totalRecords: rows.length,
    rows,
  };
}

module.exports = {
  formatDisplayDate,
  msToHHMM,
  generateDateList,
  parseISTDayRange,
  normalizeIntervals,
  computeDailyDurations,
  generateFleetReport,
  generateDriverReport,
};
