// Calendar-date helpers in a named time zone (the store's, Asia/Muscat). A
// report's "1 September to 30 September" means those days on the STORE's clock,
// so the UTC instants behind them depend on the zone. Pure functions.

const PARTS = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };

function partsInZone(ms, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, ...PARTS }).formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]));
}

// Milliseconds the zone is ahead of UTC at that instant.
function offsetMs(ms, timeZone) {
  const p = partsInZone(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// "YYYY-MM-DD" is a real calendar date.
export function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// The UTC instant when the wall clock in `timeZone` shows `date` `time`.
export function zonedTimeToUtc(date, time, timeZone) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm, ss);
  let result = wallAsUtc - offsetMs(wallAsUtc, timeZone);
  const corrected = wallAsUtc - offsetMs(result, timeZone); // across a daylight-saving change
  if (corrected !== result) result = corrected;
  return new Date(result);
}

// First and last instant of a calendar day in the zone.
export const startOfDayUtc = (date, timeZone) => zonedTimeToUtc(date, "00:00:00", timeZone);
export const endOfDayUtc = (date, timeZone) => zonedTimeToUtc(date, "23:59:59", timeZone);

// Today's date ("YYYY-MM-DD") on the zone's clock.
export function todayInZone(timeZone, now = new Date()) {
  const p = partsInZone(now.getTime(), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
