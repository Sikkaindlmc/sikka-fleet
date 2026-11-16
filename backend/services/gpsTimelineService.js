const MAX_GPS_GAP_MS = Number(process.env.GPS_REPORT_MAX_GAP_MINUTES || 90) * 60 * 1000;

function normalizeVehicleNumber(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '');
}

function istDateString(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function istDayRange(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day) - 330 * 60 * 1000);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function classifyGpsSample(sample, plants) {
  const { getVehiclePlantStatus } = require('./geofenceService');
  const evaluation = getVehiclePlantStatus(
    {
      latitude: sample.latitude,
      longitude: sample.longitude,
      gpsTimestamp: sample.gpsTimestamp || sample.gpsDateTime,
    },
    plants,
    { staleThresholdMs: Number.MAX_SAFE_INTEGER }
  );
  if (!evaluation.isInside) return 'Outside';
  const name = String(evaluation.plantName || '').toLowerCase();
  if (name.includes('dasna')) return 'DASNA';
  if (name.includes('salt')) return 'Salt Plant';
  if (name.includes('tea')) return 'Tea Plant';
  return 'Outside';
}

function uniqueChronologicalSamples(samples, plants) {
  const byTime = new Map();
  for (const sample of samples) {
    const time = new Date(sample.gpsTimestamp || sample.gpsDateTime).getTime();
    if (!Number.isFinite(time)) continue;
    const key = String(time);
    const current = byTime.get(key);
    if (!current || new Date(sample.syncTime || sample.receivedAt || 0) >= new Date(current.syncTime || current.receivedAt || 0)) {
      byTime.set(key, sample);
    }
  }
  return [...byTime.values()]
    .map((sample) => ({
      time: new Date(sample.gpsTimestamp || sample.gpsDateTime),
      status: classifyGpsSample(sample, plants),
    }))
    .sort((a, b) => a.time - b.time);
}

function buildTimeline(samples, plants, rangeStart, rangeEnd, maxGapMs = MAX_GPS_GAP_MS) {
  const points = uniqueChronologicalSamples(samples, plants);
  const segments = [];
  const append = (start, end, status) => {
    if (end > start) segments.push({ status, start: new Date(start), end: new Date(end) });
  };

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const start = point.time.getTime();
    const next = points[index + 1];
    if (!next) {
      append(start, Math.min(start + maxGapMs, rangeEnd.getTime()), point.status);
      continue;
    }

    const nextTime = next.time.getTime();
    const gap = nextTime - start;
    if (gap <= 0) continue;
    if (gap > maxGapMs) {
      append(start, start + maxGapMs, point.status);
      append(start + maxGapMs, nextTime, 'No GPS Data');
    } else if (point.status === next.status) {
      append(start, nextTime, point.status);
    } else {
      const midpoint = start + Math.floor(gap / 2);
      append(start, midpoint, point.status);
      append(midpoint, nextTime, next.status);
    }
  }

  const clipped = segments
    .map((segment) => ({
      status: segment.status,
      start: Math.max(segment.start.getTime(), rangeStart.getTime()),
      end: Math.min(segment.end.getTime(), rangeEnd.getTime()),
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((a, b) => a.start - b.start);

  const complete = [];
  let cursor = rangeStart.getTime();
  for (const segment of clipped) {
    if (segment.start > cursor) {
      complete.push({ status: 'No GPS Data', start: new Date(cursor), end: new Date(segment.start) });
    }
    if (segment.end <= cursor) continue;
    const start = Math.max(cursor, segment.start);
    complete.push({ status: segment.status, start: new Date(start), end: new Date(segment.end) });
    cursor = segment.end;
  }
  if (cursor < rangeEnd.getTime()) {
    complete.push({ status: 'No GPS Data', start: new Date(cursor), end: new Date(rangeEnd) });
  }
  return complete;
}

function allocateStatusMinutes(segments, totalMinutes) {
  const statuses = ['DASNA', 'Salt Plant', 'Tea Plant', 'Outside', 'No GPS Data'];
  const milliseconds = Object.fromEntries(statuses.map((status) => [status, 0]));
  for (const segment of segments) {
    if (milliseconds[segment.status] !== undefined) {
      milliseconds[segment.status] += segment.end.getTime() - segment.start.getTime();
    }
  }
  const allocations = statuses.map((status) => {
    const exact = milliseconds[status] / 60000;
    return { status, minutes: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remaining = Math.max(0, totalMinutes - allocations.reduce((sum, item) => sum + item.minutes, 0));
  allocations.sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; remaining > 0; index = (index + 1) % allocations.length) {
    allocations[index].minutes += 1;
    remaining -= 1;
  }
  return Object.fromEntries(allocations.map((item) => [item.status, item.minutes]));
}

function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function calculateDailyGpsHours(samples, plants, start, end) {
  const totalMinutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
  const segments = buildTimeline(samples, plants, start, end);
  return {
    totalMinutes,
    segments,
    minutes: allocateStatusMinutes(segments, totalMinutes),
  };
}

function latestStayBounds(samples, plants, latestStatus, maxGapMs = MAX_GPS_GAP_MS) {
  const points = uniqueChronologicalSamples(samples, plants);
  if (points.length === 0) return { entryGpsTimestamp: null, outsideSince: null };
  const latest = points[points.length - 1];
  if (latest.status !== latestStatus) return { entryGpsTimestamp: null, outsideSince: null };
  let first = latest;
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const previous = points[index];
    if (first.time - previous.time > maxGapMs || previous.status !== latestStatus) break;
    first = previous;
  }
  return latestStatus === 'Outside'
    ? { entryGpsTimestamp: null, outsideSince: first.time }
    : { entryGpsTimestamp: first.time, outsideSince: null };
}

module.exports = {
  MAX_GPS_GAP_MS,
  normalizeVehicleNumber,
  istDateString,
  istDayRange,
  classifyGpsSample,
  uniqueChronologicalSamples,
  buildTimeline,
  allocateStatusMinutes,
  formatMinutes,
  calculateDailyGpsHours,
  latestStayBounds,
};
