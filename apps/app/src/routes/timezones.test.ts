import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import {
  buildTimezoneList,
  getTimezoneOffsetMinutes,
  formatOffset,
  TIMEZONE_LOCATIONS,
} from "./timezones";

// Setup test app matching the route
const app = new Hono();
app.get("/api/timezones/", (c) => {
  const timezones = buildTimezoneList();
  return c.json({ timezones });
});

describe("GET /api/timezones/", () => {
  test("returns 200 with timezone list", async () => {
    const res = await app.request("/api/timezones/");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.timezones).toBeDefined();
    expect(Array.isArray(data.timezones)).toBe(true);
  });

  test("returns correct number of timezones", async () => {
    const res = await app.request("/api/timezones/");
    const data = await res.json();

    // Should match the TIMEZONE_LOCATIONS length (some may fail but most should work)
    expect(data.timezones.length).toBeGreaterThan(100);
    expect(data.timezones.length).toBeLessThanOrEqual(TIMEZONE_LOCATIONS.length);
  });

  test("each timezone has required fields", async () => {
    const res = await app.request("/api/timezones/");
    const data = await res.json();

    for (const tz of data.timezones) {
      expect(tz.utc_offset).toBeDefined();
      expect(tz.gmt_offset).toBeDefined();
      expect(tz.value).toBeDefined();
      expect(tz.label).toBeDefined();

      // utc_offset should match format "UTC+HH:MM" or "UTC-HH:MM"
      expect(tz.utc_offset).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
      expect(tz.gmt_offset).toMatch(/^GMT[+-]\d{2}:\d{2}$/);

      // label should be a non-empty string
      expect(tz.label.length).toBeGreaterThan(0);

      // value should be an IANA timezone identifier
      expect(tz.value.length).toBeGreaterThan(0);
      expect(tz.value).toContain("/");
    }
  });

  test("timezones are sorted by offset", async () => {
    const res = await app.request("/api/timezones/");
    const data = await res.json();

    // Parse offsets to verify sort order
    for (let i = 1; i < data.timezones.length; i++) {
      const prevOffset = data.timezones[i - 1].utc_offset;
      const currOffset = data.timezones[i].utc_offset;

      // Extract numeric offset for comparison
      const parseOffset = (s: string) => {
        const match = s.match(/([+-])(\d{2}):(\d{2})$/);
        if (!match) return 0;
        const sign = match[1] === "+" ? 1 : -1;
        return sign * (parseInt(match[2]) * 60 + parseInt(match[3]));
      };

      expect(parseOffset(prevOffset)).toBeLessThanOrEqual(parseOffset(currOffset));
    }
  });

  test("contains well-known timezones", async () => {
    const res = await app.request("/api/timezones/");
    const data = await res.json();

    const values = data.timezones.map((tz: { value: string }) => tz.value);

    expect(values).toContain("America/New_York");
    expect(values).toContain("America/Los_Angeles");
    expect(values).toContain("Europe/Paris");
    expect(values).toContain("Asia/Tokyo");
    expect(values).toContain("Asia/Kolkata");
    expect(values).toContain("Pacific/Auckland");
    expect(values).toContain("Pacific/Honolulu");
  });

  test("does not include internal offset field", async () => {
    const res = await app.request("/api/timezones/");
    const data = await res.json();

    for (const tz of data.timezones) {
      expect(tz.offsetMinutes).toBeUndefined();
      expect(tz.offset).toBeUndefined();
    }
  });

  test("returns consistent results (cache behavior)", async () => {
    const res1 = await app.request("/api/timezones/");
    const data1 = await res1.json();

    const res2 = await app.request("/api/timezones/");
    const data2 = await res2.json();

    expect(data1.timezones.length).toBe(data2.timezones.length);
    expect(data1.timezones[0].value).toBe(data2.timezones[0].value);
    expect(data1.timezones[0].utc_offset).toBe(data2.timezones[0].utc_offset);
  });
});

describe("getTimezoneOffsetMinutes()", () => {
  test("returns correct offset for UTC", async () => {
    const now = new Date();
    // UTC should always have 0 offset
    const offset = getTimezoneOffsetMinutes("Etc/UTC", now);
    expect(Math.abs(offset)).toBe(0);
  });

  test("returns positive offset for Asia/Kolkata", async () => {
    const now = new Date();
    const offset = getTimezoneOffsetMinutes("Asia/Kolkata", now);
    // India is always UTC+05:30 = 330 minutes
    expect(offset).toBe(330);
  });

  test("returns positive offset for Asia/Tokyo", async () => {
    const now = new Date();
    const offset = getTimezoneOffsetMinutes("Asia/Tokyo", now);
    // Japan is always UTC+09:00 = 540 minutes (no DST)
    expect(offset).toBe(540);
  });

  test("returns negative offset for Pacific/Honolulu", async () => {
    const now = new Date();
    const offset = getTimezoneOffsetMinutes("Pacific/Honolulu", now);
    // Hawaii is always UTC-10:00 = -600 minutes (no DST)
    expect(offset).toBe(-600);
  });
});

describe("formatOffset()", () => {
  test("formats positive offset", () => {
    expect(formatOffset(330)).toBe("+05:30");
    expect(formatOffset(540)).toBe("+09:00");
    expect(formatOffset(0)).toBe("+00:00");
  });

  test("formats negative offset", () => {
    expect(formatOffset(-600)).toBe("-10:00");
    expect(formatOffset(-300)).toBe("-05:00");
    expect(formatOffset(-210)).toBe("-03:30");
  });

  test("handles fractional offsets", () => {
    expect(formatOffset(345)).toBe("+05:45"); // Nepal
    expect(formatOffset(-570)).toBe("-09:30"); // Marquesas
  });
});
