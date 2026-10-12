// The quick date choices of the request screen. All dates are store days
// ("YYYY-MM-DD"), counted from the store's own "today".
import { addDays } from "./dates.js";

export const DATE_PRESETS = Object.freeze([
  { key: "monthToDate", label: "Month to date" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "lastMonth", label: "Last month" },
  { key: "lastQuarter", label: "Last quarter" },
  { key: "custom", label: "Custom" },
]);

const pad = (n) => String(n).padStart(2, "0");
const lastDayOf = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-12

// { from, to } for a preset on `today`, or null for "custom".
export function presetRange(key, today) {
  const [year, month] = today.split("-").map(Number);
  switch (key) {
    case "monthToDate":
      return { from: `${year}-${pad(month)}-01`, to: today };
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "lastMonth": {
      const y = month === 1 ? year - 1 : year;
      const m = month === 1 ? 12 : month - 1;
      return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}` };
    }
    case "lastQuarter": {
      const quarter = Math.floor((month - 1) / 3); // 0-3, this quarter
      const y = quarter === 0 ? year - 1 : year;
      const startMonth = (quarter === 0 ? 3 : quarter - 1) * 3 + 1;
      const endMonth = startMonth + 2;
      return { from: `${y}-${pad(startMonth)}-01`, to: `${y}-${pad(endMonth)}-${pad(lastDayOf(y, endMonth))}` };
    }
    default:
      return null;
  }
}

// Which preset the dates match, or "custom".
export function matchPreset(from, to, today) {
  for (const { key } of DATE_PRESETS) {
    const range = presetRange(key, today);
    if (range && range.from === from && range.to === to) return key;
  }
  return "custom";
}
