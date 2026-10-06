const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function makeISTDayStart(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - (5.5 * 3600 * 1000));
}

function makeISTDayEnd(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - (5.5 * 3600 * 1000));
}

function formatDisplayDate(year, month, day) {
  return `${String(day).padStart(2, '0')}-${MONTHS_SHORT[month - 1]}-${year}`;
}

function parseQueryDateTimeRange(queryText) {
  const q = queryText.toLowerCase();
  const now = new Date('2026-10-06T17:38:30+05:30'); // reference current time in prompt
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const currentIst = new Date(now.getTime() + istOffsetMs);
  const curYear = currentIst.getUTCFullYear();
  const curMonth = currentIst.getUTCMonth() + 1;
  const curDay = currentIst.getUTCDate();

  const monthNames = {
    january: 1, jan: 1, janvari: 1,
    february: 2, feb: 2, farvari: 2,
    march: 3, mar: 3,
    april: 4, apr: 4,
    may: 5, mai: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8, agast: 8,
    september: 9, sep: 9, sept: 9, sitambar: 9,
    october: 10, oct: 10, aktubar: 10,
    november: 11, nov: 11, navambar: 11,
    december: 12, dec: 12, disambar: 12,
  };

  const monthRegex = '(?:january|jan|janvari|february|feb|farvari|march|mar|april|apr|may|mai|june|jun|july|jul|august|aug|agast|september|sep|sept|sitambar|october|oct|aktubar|november|nov|navambar|december|dec)';

  let hasDate = false;
  let isRange = false;
  let startDate = null;
  let endDate = null;
  let dateStr = '';
  let rangeStr = '';

  // Check Range: e.g. "25 september se 30 september tak" or "25 se 30 september"
  const rangePattern = new RegExp(
    `(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*(${monthRegex})?\\s*(?:se|to|-)\\s*(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*(${monthRegex})(?:\\s*(\\d{4}))?`,
    'i'
  );
  const rangeMatch = q.match(rangePattern);

  if (rangeMatch) {
    const d1 = parseInt(rangeMatch[1], 10);
    const m1Str = rangeMatch[2] ? rangeMatch[2].toLowerCase() : rangeMatch[4].toLowerCase();
    const d2 = parseInt(rangeMatch[3], 10);
    const m2Str = rangeMatch[4].toLowerCase();
    const yr = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : curYear;

    const m1 = monthNames[m1Str] || 9;
    const m2 = monthNames[m2Str] || 9;

    startDate = makeISTDayStart(yr, m1, d1);
    endDate = makeISTDayEnd(yr, m2, d2);
    isRange = true;
    hasDate = true;
    rangeStr = `${formatDisplayDate(yr, m1, d1)} to ${formatDisplayDate(yr, m2, d2)}`;
  } else {
    // Single Date check:
    if (q.includes('aaj') || q.includes('today')) {
      hasDate = true;
      startDate = makeISTDayStart(curYear, curMonth, curDay);
      endDate = makeISTDayEnd(curYear, curMonth, curDay);
      dateStr = `${String(curDay).padStart(2, '0')}-${MONTHS_SHORT[curMonth - 1]}-${curYear}`;
    } else if (q.includes('kal') || q.includes('yesterday')) {
      const yDay = new Date(currentIst.getTime() - 24 * 3600 * 1000);
      const yYear = yDay.getUTCFullYear();
      const yMonth = yDay.getUTCMonth() + 1;
      const yDate = yDay.getUTCDate();
      hasDate = true;
      startDate = makeISTDayStart(yYear, yMonth, yDate);
      endDate = makeISTDayEnd(yYear, yMonth, yDate);
      dateStr = `${String(yDate).padStart(2, '0')}-${MONTHS_SHORT[yMonth - 1]}-${yYear}`;
    } else {
      const singleDatePattern = new RegExp(
        `(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*(${monthRegex})(?:\\s*(\\d{4}))?`,
        'i'
      );
      const singleMatch = q.match(singleDatePattern);
      if (singleMatch) {
        const d = parseInt(singleMatch[1], 10);
        const mStr = singleMatch[2].toLowerCase();
        const m = monthNames[mStr] || 9;
        const yr = singleMatch[3] ? parseInt(singleMatch[3], 10) : curYear;

        hasDate = true;
        startDate = makeISTDayStart(yr, m, d);
        endDate = makeISTDayEnd(yr, m, d);
        dateStr = `${String(d).padStart(2, '0')}-${MONTHS_SHORT[m - 1]}-${yr}`;
      } else {
        const numMatch = q.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
        if (numMatch) {
          const d = parseInt(numMatch[1], 10);
          const m = parseInt(numMatch[2], 10);
          const yr = numMatch[3] ? (numMatch[3].length === 2 ? 2000 + parseInt(numMatch[3], 10) : parseInt(numMatch[3], 10)) : curYear;
          if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
            hasDate = true;
            startDate = makeISTDayStart(yr, m, d);
            endDate = makeISTDayEnd(yr, m, d);
            dateStr = `${String(d).padStart(2, '0')}-${MONTHS_SHORT[m - 1]}-${yr}`;
          }
        }
      }
    }
  }

  // Parse Time:
  let hasTime = false;
  let targetHour = null;
  let targetMinute = 0;
  let timeStr = '';

  const timeStrictMatch = q.match(/(?:at|par|ko)?\s*(\d{1,2}):(\d{2})\s*(am|pm)?/i) ||
    q.match(/(\d{1,2})\s*(am|pm)/i) ||
    q.match(/(\d{1,2})(?::(\d{2}))?\s*baje/i);

  if (timeStrictMatch) {
    hasTime = true;
    let h = parseInt(timeStrictMatch[1], 10);
    let min = timeStrictMatch[2] ? parseInt(timeStrictMatch[2], 10) : 0;
    const ampm = timeStrictMatch[3] ? timeStrictMatch[3].toLowerCase() : (q.match(/\b(am|pm)\b/i) ? q.match(/\b(am|pm)\b/i)[1].toLowerCase() : null);

    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    if (!ampm) {
      if (h >= 1 && h <= 7) h += 12;
    }

    targetHour = h;
    targetMinute = min;
    const period = h >= 12 ? 'PM' : 'AM';
    const dispH = h % 12 === 0 ? 12 : (h > 12 ? h - 12 : h);
    timeStr = `${String(dispH).padStart(2, '0')}:${String(min).padStart(2, '0')} ${period}`;
  }

  return {
    hasDate,
    isRange,
    startDate,
    endDate,
    dateStr,
    rangeStr,
    hasTime,
    targetHour,
    targetMinute,
    timeStr,
  };
}

const testQueries = [
  'Aaj UP14GT0300 kahan hai?',
  '29 September ko UP14GT0300 kahan tha?',
  '29 September ko 11:30 AM par UP14GT0300 ki location kya thi?',
  'Kal 3 PM par Rajesh driver kahan tha?',
  'UP14GT0300 Tea Plant mein kitne hours raha?',
  '25 September se 30 September tak vehicle ka movement batao.',
  'Kaun-kaun se vehicles aaj Tea Plant mein available the?',
  'Vehicle aur driver ki location 29 September ko 2 PM par batao.',
  'UP14GT0300 ka GPS sync karo.',
  'Aaj 10:30 AM par UP14GT0300 kahan tha?',
];

for (const q of testQueries) {
  const res = parseQueryDateTimeRange(q);
  console.log(`Q: "${q}" -> Date: ${res.dateStr || (res.isRange ? res.rangeStr : 'None')}, Time: ${res.timeStr || 'None'}, isRange: ${res.isRange}`);
}
