// utils/time.js — Shared timezone-safe date, offset, conversion, and streak utilities

/**
 * Returns the configured IANA timezone, falling back safely to 'UTC' if invalid.
 */
function getTimeZone() {
  const tz = (process.env.TIMEZONE || 'UTC').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/**
 * Extracts wall-clock date/time components in the target timezone using 24h hourCycle ('h23': 0..23).
 */
function getLocalParts(date = new Date(), tz = getTimeZone()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10);
  const day = parseInt(parts.day, 10);
  const hour = parseInt(parts.hour, 10) % 24;
  const minute = parseInt(parts.minute, 10);
  const second = parseInt(parts.second, 10);

  const monthStr = String(month).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dayOfWeek,
    dateStr: `${monthStr}/${dayStr}/${year}`, // MM/DD/YYYY (matches DB daily_problems keys)
    isoDate: `${year}-${monthStr}-${dayStr}`   // YYYY-MM-DD
  };
}

/**
 * Computes exact timezone offset in minutes relative to UTC at the given instant.
 */
function getTzOffsetMinutes(date = new Date(), tz = getTimeZone()) {
  const p = getLocalParts(date, tz);
  const localAsUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const utcMs = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds()
  );
  return Math.round((localAsUtcMs - utcMs) / 60000);
}

/**
 * Converts a wall-clock date/time in `tz` to Unix epoch seconds using two-pass DST adjustment.
 */
function zonedDateTimeToUnix(year, month, day, hours = 0, minutes = 0, seconds = 0, tz = getTimeZone()) {
  const targetUtcMs = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const offset1 = getTzOffsetMinutes(new Date(targetUtcMs), tz);
  const pass1 = new Date(targetUtcMs - offset1 * 60000);
  const offset2 = getTzOffsetMinutes(pass1, tz);
  return Math.floor((targetUtcMs - offset2 * 60000) / 1000);
}

/**
 * Validates that year/month/day form an actual calendar date without overflow (e.g. rejects Feb 30).
 */
function isValidCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && (d.getUTCMonth() + 1) === month && d.getUTCDate() === day;
}

/**
 * Computes { current, max, todayActive } consecutive daily activity streak from Unix timestamps (seconds).
 */
function calculateStreakFromTimestamps(timestampsSeconds, tz = getTimeZone()) {
  const activityDates = new Set();
  for (const ts of timestampsSeconds) {
    if (!Number.isFinite(ts) || ts <= 0) continue;
    activityDates.add(getLocalParts(new Date(ts * 1000), tz).isoDate);
  }

  if (activityDates.size === 0) {
    return { current: 0, max: 0, todayActive: false };
  }

  const todayParts = getLocalParts(new Date(), tz);
  const todayIso = todayParts.isoDate;
  const todayActive = activityDates.has(todayIso);

  const checkDate = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day));
  if (!todayActive) {
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
  }

  let current = 0;
  while (true) {
    const iso = checkDate.toISOString().split('T')[0];
    if (activityDates.has(iso)) {
      current++;
      checkDate.setUTCDate(checkDate.getUTCDate() - 1);
    } else {
      break;
    }
  }

  const sortedDates = [...activityDates].sort();
  let max = 0;
  let run = 0;
  let prevMs = null;
  for (const iso of sortedDates) {
    const [y, m, d] = iso.split('-').map(Number);
    const ms = Date.UTC(y, m - 1, d);
    if (prevMs === null) {
      run = 1;
    } else {
      const diffDays = Math.round((ms - prevMs) / 86400000);
      if (diffDays === 1) {
        run++;
      } else if (diffDays > 1) {
        max = Math.max(max, run);
        run = 1;
      }
    }
    prevMs = ms;
  }
  max = Math.max(max, run);

  return { current, max, todayActive };
}

module.exports = {
  getTimeZone,
  getLocalParts,
  getTzOffsetMinutes,
  zonedDateTimeToUnix,
  isValidCalendarDate,
  calculateStreakFromTimestamps
};
