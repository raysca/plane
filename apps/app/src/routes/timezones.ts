import { Hono } from "hono";
import type { Variables } from "../app";

// Static list of timezone locations matching Django's TimezoneEndpoint
const TIMEZONE_LOCATIONS: [string, string][] = [
  ["Midway Island", "Pacific/Midway"],
  ["American Samoa", "Pacific/Pago_Pago"],
  ["Hawaii", "Pacific/Honolulu"],
  ["Aleutian Islands", "America/Adak"],
  ["Marquesas Islands", "Pacific/Marquesas"],
  ["Alaska", "America/Anchorage"],
  ["Gambier Islands", "Pacific/Gambier"],
  ["Pacific Time (US and Canada)", "America/Los_Angeles"],
  ["Baja California", "America/Tijuana"],
  ["Mountain Time (US and Canada)", "America/Denver"],
  ["Arizona", "America/Phoenix"],
  ["Chihuahua, Mazatlan", "America/Chihuahua"],
  ["Central Time (US and Canada)", "America/Chicago"],
  ["Saskatchewan", "America/Regina"],
  ["Guadalajara, Mexico City, Monterrey", "America/Mexico_City"],
  ["Tegucigalpa, Honduras", "America/Tegucigalpa"],
  ["Costa Rica", "America/Costa_Rica"],
  ["Eastern Time (US and Canada)", "America/New_York"],
  ["Lima", "America/Lima"],
  ["Bogota", "America/Bogota"],
  ["Quito", "America/Guayaquil"],
  ["Chetumal", "America/Cancun"],
  ["Caracas (Old Venezuela Time)", "America/Caracas"],
  ["Atlantic Time (Canada)", "America/Halifax"],
  ["Caracas", "America/Caracas"],
  ["Santiago", "America/Santiago"],
  ["La Paz", "America/La_Paz"],
  ["Manaus", "America/Manaus"],
  ["Georgetown", "America/Guyana"],
  ["Bermuda", "Atlantic/Bermuda"],
  ["Newfoundland Time (Canada)", "America/St_Johns"],
  ["Buenos Aires", "America/Argentina/Buenos_Aires"],
  ["Brasilia", "America/Sao_Paulo"],
  ["Greenland", "America/Godthab"],
  ["Montevideo", "America/Montevideo"],
  ["Falkland Islands", "Atlantic/Stanley"],
  ["South Georgia and the South Sandwich Islands", "Atlantic/South_Georgia"],
  ["Azores", "Atlantic/Azores"],
  ["Cape Verde Islands", "Atlantic/Cape_Verde"],
  ["Dublin", "Europe/Dublin"],
  ["Reykjavik", "Atlantic/Reykjavik"],
  ["Lisbon", "Europe/Lisbon"],
  ["Monrovia", "Africa/Monrovia"],
  ["Casablanca", "Africa/Casablanca"],
  ["Central European Time (Berlin, Rome, Paris)", "Europe/Paris"],
  ["West Central Africa", "Africa/Lagos"],
  ["Algiers", "Africa/Algiers"],
  ["Lagos", "Africa/Lagos"],
  ["Tunis", "Africa/Tunis"],
  ["Eastern European Time (Cairo, Helsinki, Kyiv)", "Europe/Kyiv"],
  ["Athens", "Europe/Athens"],
  ["Jerusalem", "Asia/Jerusalem"],
  ["Johannesburg", "Africa/Johannesburg"],
  ["Harare, Pretoria", "Africa/Harare"],
  ["Moscow Time", "Europe/Moscow"],
  ["Baghdad", "Asia/Baghdad"],
  ["Nairobi", "Africa/Nairobi"],
  ["Kuwait, Riyadh", "Asia/Riyadh"],
  ["Tehran", "Asia/Tehran"],
  ["Abu Dhabi", "Asia/Dubai"],
  ["Baku", "Asia/Baku"],
  ["Yerevan", "Asia/Yerevan"],
  ["Astrakhan", "Europe/Astrakhan"],
  ["Tbilisi", "Asia/Tbilisi"],
  ["Mauritius", "Indian/Mauritius"],
  ["Kabul", "Asia/Kabul"],
  ["Islamabad", "Asia/Karachi"],
  ["Karachi", "Asia/Karachi"],
  ["Tashkent", "Asia/Tashkent"],
  ["Yekaterinburg", "Asia/Yekaterinburg"],
  ["Maldives", "Indian/Maldives"],
  ["Chagos", "Indian/Chagos"],
  ["Chennai", "Asia/Kolkata"],
  ["Kolkata", "Asia/Kolkata"],
  ["Mumbai", "Asia/Kolkata"],
  ["New Delhi", "Asia/Kolkata"],
  ["Sri Jayawardenepura", "Asia/Colombo"],
  ["Kathmandu", "Asia/Kathmandu"],
  ["Dhaka", "Asia/Dhaka"],
  ["Almaty", "Asia/Almaty"],
  ["Bishkek", "Asia/Bishkek"],
  ["Thimphu", "Asia/Thimphu"],
  ["Yangon (Rangoon)", "Asia/Yangon"],
  ["Cocos Islands", "Indian/Cocos"],
  ["Bangkok", "Asia/Bangkok"],
  ["Hanoi", "Asia/Ho_Chi_Minh"],
  ["Jakarta", "Asia/Jakarta"],
  ["Novosibirsk", "Asia/Novosibirsk"],
  ["Krasnoyarsk", "Asia/Krasnoyarsk"],
  ["Beijing", "Asia/Shanghai"],
  ["Singapore", "Asia/Singapore"],
  ["Perth", "Australia/Perth"],
  ["Hong Kong", "Asia/Hong_Kong"],
  ["Ulaanbaatar", "Asia/Ulaanbaatar"],
  ["Palau", "Pacific/Palau"],
  ["Eucla", "Australia/Eucla"],
  ["Tokyo", "Asia/Tokyo"],
  ["Seoul", "Asia/Seoul"],
  ["Yakutsk", "Asia/Yakutsk"],
  ["Adelaide", "Australia/Adelaide"],
  ["Darwin", "Australia/Darwin"],
  ["Sydney", "Australia/Sydney"],
  ["Brisbane", "Australia/Brisbane"],
  ["Guam", "Pacific/Guam"],
  ["Vladivostok", "Asia/Vladivostok"],
  ["Tahiti", "Pacific/Tahiti"],
  ["Lord Howe Island", "Australia/Lord_Howe"],
  ["Solomon Islands", "Pacific/Guadalcanal"],
  ["Magadan", "Asia/Magadan"],
  ["Norfolk Island", "Pacific/Norfolk"],
  ["Bougainville Island", "Pacific/Bougainville"],
  ["Chokurdakh", "Asia/Srednekolymsk"],
  ["Auckland", "Pacific/Auckland"],
  ["Wellington", "Pacific/Auckland"],
  ["Fiji Islands", "Pacific/Fiji"],
  ["Anadyr", "Asia/Anadyr"],
  ["Chatham Islands", "Pacific/Chatham"],
  ["Nuku'alofa", "Pacific/Tongatapu"],
  ["Samoa", "Pacific/Apia"],
  ["Kiritimati Island", "Pacific/Kiritimati"],
];

/**
 * Get the current UTC offset in total minutes for a given IANA timezone.
 * Uses Intl.DateTimeFormat to compute live DST-aware offsets.
 */
function getTimezoneOffsetMinutes(tzIdentifier: string, now: Date): number {
  // Format the date in the target timezone to extract parts
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tzIdentifier,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";

  const year = parseInt(get("year"));
  const month = parseInt(get("month")) - 1;
  const day = parseInt(get("day"));
  let hour = parseInt(get("hour"));
  if (hour === 24) hour = 0; // midnight edge case
  const minute = parseInt(get("minute"));
  const second = parseInt(get("second"));

  // Create a Date in UTC matching the local time in the target timezone
  const localAsUtc = Date.UTC(year, month, day, hour, minute, second);
  const utcTime = now.getTime();

  // Offset = localTime - utcTime (in minutes)
  return Math.round((localAsUtc - utcTime) / 60000);
}

/**
 * Format offset minutes as "+HH:MM" or "-HH:MM"
 */
function formatOffset(totalMinutes: number): string {
  const sign = totalMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(totalMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Cached timezone list (regenerated every 2 hours like Django's cache_page) */
let cachedTimezones: { utc_offset: string; gmt_offset: string; value: string; label: string }[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours in ms

function buildTimezoneList(): typeof cachedTimezones {
  const now = new Date();

  // Check cache
  if (cachedTimezones && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedTimezones;
  }

  const timezoneList: { offsetMinutes: number; utc_offset: string; gmt_offset: string; value: string; label: string }[] = [];

  for (const [friendlyName, tzIdentifier] of TIMEZONE_LOCATIONS) {
    try {
      const offsetMinutes = getTimezoneOffsetMinutes(tzIdentifier, now);
      const offset = formatOffset(offsetMinutes);

      timezoneList.push({
        offsetMinutes,
        utc_offset: `UTC${offset}`,
        gmt_offset: `GMT${offset}`,
        value: tzIdentifier,
        label: friendlyName,
      });
    } catch {
      // Skip unknown timezone
      continue;
    }
  }

  // Sort by offset then by label (matching Django behavior)
  timezoneList.sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label));

  // Remove the sorting key from output
  cachedTimezones = timezoneList.map(({ offsetMinutes, ...rest }) => rest);
  cacheTimestamp = Date.now();

  return cachedTimezones;
}

// Routes
const timezoneRoutes = new Hono<{ Variables: Variables }>();

// GET /api/timezones/ — Public endpoint, no auth required
timezoneRoutes.get("/", (c) => {
  const timezones = buildTimezoneList();
  return c.json({ timezones });
});

export { timezoneRoutes, buildTimezoneList, getTimezoneOffsetMinutes, formatOffset, TIMEZONE_LOCATIONS };
