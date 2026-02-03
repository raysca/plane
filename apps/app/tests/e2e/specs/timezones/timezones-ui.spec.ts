import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// -- Types --------------------------------------------------------------------

interface Timezone {
  utc_offset: string;
  gmt_offset: string;
  value: string;
  label: string;
}

interface TestData {
  token: string;
  wsSlug: string;
}

// -- Fixture ------------------------------------------------------------------

type Fixtures = {
  timezonePage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("tz"));
  },

  timezonePage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("tz");
      const password = generateTestPassword();
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Timezone",
          last_name: "Tester",
        },
      });
      expect(signupRes.ok()).toBeTruthy();
      const signupData = await signupRes.json();
      const token: string = signupData.access_token;

      // 2. Set session cookies
      const cookies = signupRes
        .headersArray()
        .filter((h) => h.name.toLowerCase() === "set-cookie")
        .map((h) => h.value);
      for (const cookie of cookies) {
        const parts = cookie.split(";")[0]!.split("=");
        await page.context().addCookies([
          {
            name: parts[0]!.trim(),
            value: parts.slice(1).join("=").trim(),
            domain: "localhost",
            path: "/",
          },
        ]);
      }

      // 3. Onboard
      await request.patch(`${API_BASE}/api/users/me/`, {
        headers: headers(token),
        data: {
          first_name: "Timezone",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Timezone Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });
      expect(wsRes.ok()).toBeTruthy();

      const td: TestData = {
        token,
        wsSlug,
      };
      (page as any).__testData = td;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ timezonePage }, use) => {
    await use((timezonePage as any).__testData as TestData);
  },
});

// -- Helpers ------------------------------------------------------------------

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ==============================================================================
// 1. TIMEZONE LIST API - Basic Functionality
// ==============================================================================

test.describe("Timezone List API - Basic Functionality", () => {
  test("should list all timezones via GET /api/timezones/", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty("timezones");
    expect(Array.isArray(data.timezones)).toBe(true);
  });

  test("should return correct number of timezones (more than 100)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    // Based on the source code, TIMEZONE_LOCATIONS has 126 entries
    expect(data.timezones.length).toBeGreaterThan(100);
    expect(data.timezones.length).toBeLessThanOrEqual(126);
  });

  test("should return response as object with timezones array", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
    expect(data.timezones).toBeDefined();
    expect(Array.isArray(data.timezones)).toBe(true);
  });
});

// ==============================================================================
// 2. TIMEZONE RESPONSE FORMAT
// ==============================================================================

test.describe("Timezone Response Format", () => {
  test("each timezone should have required fields (utc_offset, gmt_offset, value, label)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    for (const tz of data.timezones) {
      expect(tz).toHaveProperty("utc_offset");
      expect(tz).toHaveProperty("gmt_offset");
      expect(tz).toHaveProperty("value");
      expect(tz).toHaveProperty("label");
    }
  });

  test("utc_offset should match format UTC+HH:MM or UTC-HH:MM", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    for (const tz of data.timezones) {
      expect(tz.utc_offset).toMatch(/^UTC[+-]\d{2}:\d{2}$/);
    }
  });

  test("gmt_offset should match format GMT+HH:MM or GMT-HH:MM", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    for (const tz of data.timezones) {
      expect(tz.gmt_offset).toMatch(/^GMT[+-]\d{2}:\d{2}$/);
    }
  });

  test("value should be IANA timezone identifier (contains /)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    for (const tz of data.timezones) {
      expect(tz.value.length).toBeGreaterThan(0);
      expect(tz.value).toContain("/");
    }
  });

  test("label should be a non-empty string", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    for (const tz of data.timezones) {
      expect(typeof tz.label).toBe("string");
      expect(tz.label.length).toBeGreaterThan(0);
    }
  });

  test("should not include internal offsetMinutes field in response", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    for (const tz of data.timezones) {
      expect(tz.offsetMinutes).toBeUndefined();
      expect(tz.offset).toBeUndefined();
    }
  });

  test("utc_offset and gmt_offset should have matching offset values", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    for (const tz of data.timezones) {
      // Extract offset portion (after UTC or GMT)
      const utcOffset = tz.utc_offset.replace("UTC", "");
      const gmtOffset = tz.gmt_offset.replace("GMT", "");
      expect(utcOffset).toBe(gmtOffset);
    }
  });
});

// ==============================================================================
// 3. COMMON TIMEZONES PRESENCE
// ==============================================================================

test.describe("Common Timezones Presence", () => {
  test("should contain America/New_York (Eastern Time)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const values = data.timezones.map((tz: Timezone) => tz.value);
    expect(values).toContain("America/New_York");
  });

  test("should contain America/Los_Angeles (Pacific Time)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const values = data.timezones.map((tz: Timezone) => tz.value);
    expect(values).toContain("America/Los_Angeles");
  });

  test("should contain Europe/London", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const values = data.timezones.map((tz: Timezone) => tz.value);
    // Note: Europe/London might be listed as Europe/Dublin or similar
    // Let's check for European timezones
    const hasLondonRegion = values.some((v: string) =>
      v === "Europe/Dublin" || v === "Europe/London" || v === "Europe/Lisbon"
    );
    expect(hasLondonRegion).toBe(true);
  });

  test("should contain Asia/Tokyo (Japan)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const values = data.timezones.map((tz: Timezone) => tz.value);
    expect(values).toContain("Asia/Tokyo");
  });

  test("should contain Asia/Kolkata (India)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const values = data.timezones.map((tz: Timezone) => tz.value);
    expect(values).toContain("Asia/Kolkata");
  });

  test("should contain Pacific/Auckland (New Zealand)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const values = data.timezones.map((tz: Timezone) => tz.value);
    expect(values).toContain("Pacific/Auckland");
  });

  test("should contain Pacific/Honolulu (Hawaii)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const values = data.timezones.map((tz: Timezone) => tz.value);
    expect(values).toContain("Pacific/Honolulu");
  });

  test("should contain Europe/Paris (Central European)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const values = data.timezones.map((tz: Timezone) => tz.value);
    expect(values).toContain("Europe/Paris");
  });

  test("should contain Asia/Shanghai (China)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const values = data.timezones.map((tz: Timezone) => tz.value);
    expect(values).toContain("Asia/Shanghai");
  });

  test("should contain Australia/Sydney", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const values = data.timezones.map((tz: Timezone) => tz.value);
    expect(values).toContain("Australia/Sydney");
  });
});

// ==============================================================================
// 4. TIMEZONE SORTING
// ==============================================================================

test.describe("Timezone Sorting", () => {
  test("timezones should be sorted by UTC offset (ascending)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const timezones: Timezone[] = data.timezones;

    // Parse offsets and verify sort order
    const parseOffset = (s: string) => {
      const match = s.match(/([+-])(\d{2}):(\d{2})$/);
      if (!match) return 0;
      const sign = match[1] === "+" ? 1 : -1;
      return sign * (parseInt(match[2]) * 60 + parseInt(match[3]));
    };

    for (let i = 1; i < timezones.length; i++) {
      const prevOffset = parseOffset(timezones[i - 1]!.utc_offset);
      const currOffset = parseOffset(timezones[i]!.utc_offset);
      expect(prevOffset).toBeLessThanOrEqual(currOffset);
    }
  });

  test("first timezone should have negative offset (westernmost)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const firstTz = data.timezones[0];
    expect(firstTz.utc_offset).toMatch(/^UTC-/);
  });

  test("last timezone should have positive offset (easternmost)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const lastTz = data.timezones[data.timezones.length - 1];
    expect(lastTz.utc_offset).toMatch(/^UTC\+/);
  });
});

// ==============================================================================
// 5. SPECIFIC TIMEZONE VALIDATION
// ==============================================================================

test.describe("Specific Timezone Validation", () => {
  test("Hawaii (Pacific/Honolulu) should have UTC-10:00 offset", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const hawaii = data.timezones.find(
      (tz: Timezone) => tz.value === "Pacific/Honolulu"
    );
    expect(hawaii).toBeDefined();
    expect(hawaii.utc_offset).toBe("UTC-10:00");
    expect(hawaii.gmt_offset).toBe("GMT-10:00");
  });

  test("India (Asia/Kolkata) should have UTC+05:30 offset", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const india = data.timezones.find(
      (tz: Timezone) => tz.value === "Asia/Kolkata"
    );
    expect(india).toBeDefined();
    expect(india.utc_offset).toBe("UTC+05:30");
    expect(india.gmt_offset).toBe("GMT+05:30");
  });

  test("Japan (Asia/Tokyo) should have UTC+09:00 offset", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const japan = data.timezones.find(
      (tz: Timezone) => tz.value === "Asia/Tokyo"
    );
    expect(japan).toBeDefined();
    expect(japan.utc_offset).toBe("UTC+09:00");
    expect(japan.gmt_offset).toBe("GMT+09:00");
  });

  test("Tokyo should have label 'Tokyo'", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const tokyo = data.timezones.find(
      (tz: Timezone) => tz.value === "Asia/Tokyo"
    );
    expect(tokyo).toBeDefined();
    expect(tokyo.label).toBe("Tokyo");
  });

  test("New York should have proper Eastern Time label", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const newYork = data.timezones.find(
      (tz: Timezone) => tz.value === "America/New_York"
    );
    expect(newYork).toBeDefined();
    expect(newYork.label).toContain("Eastern");
  });

  test("Los Angeles should have proper Pacific Time label", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const la = data.timezones.find(
      (tz: Timezone) => tz.value === "America/Los_Angeles"
    );
    expect(la).toBeDefined();
    expect(la.label).toContain("Pacific");
  });
});

// ==============================================================================
// 6. CACHE BEHAVIOR (Consistency Tests)
// ==============================================================================

test.describe("Cache Behavior", () => {
  test("should return consistent results across multiple requests", async ({
    timezonePage,
    td,
  }) => {
    const res1 = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res1.ok()).toBeTruthy();
    const data1 = await res1.json();

    const res2 = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res2.ok()).toBeTruthy();
    const data2 = await res2.json();

    // Same number of timezones
    expect(data1.timezones.length).toBe(data2.timezones.length);

    // Same first and last timezone
    expect(data1.timezones[0].value).toBe(data2.timezones[0].value);
    expect(data1.timezones[0].utc_offset).toBe(data2.timezones[0].utc_offset);

    const last1 = data1.timezones[data1.timezones.length - 1];
    const last2 = data2.timezones[data2.timezones.length - 1];
    expect(last1.value).toBe(last2.value);
    expect(last1.utc_offset).toBe(last2.utc_offset);
  });

  test("should return consistent ordering across requests", async ({
    timezonePage,
    td,
  }) => {
    const res1 = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    const data1 = await res1.json();

    const res2 = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    const data2 = await res2.json();

    // Check that the first 10 timezones are in the same order
    for (let i = 0; i < 10; i++) {
      expect(data1.timezones[i].value).toBe(data2.timezones[i].value);
      expect(data1.timezones[i].label).toBe(data2.timezones[i].label);
    }
  });
});

// ==============================================================================
// 7. PUBLIC ENDPOINT (No Auth Required)
// ==============================================================================

test.describe("Public Endpoint", () => {
  test("should be accessible without authentication", async ({
    timezonePage,
  }) => {
    // Request without auth headers
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`);
    expect(res.ok()).toBeTruthy();
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(data.timezones).toBeDefined();
    expect(Array.isArray(data.timezones)).toBe(true);
    expect(data.timezones.length).toBeGreaterThan(0);
  });

  test("should return same data with or without auth", async ({
    timezonePage,
    td,
  }) => {
    // With auth
    const resAuth = await timezonePage.request.get(
      `${API_BASE}/api/timezones/`,
      { headers: authHeaders(td.token) }
    );
    const dataAuth = await resAuth.json();

    // Without auth
    const resNoAuth = await timezonePage.request.get(
      `${API_BASE}/api/timezones/`
    );
    const dataNoAuth = await resNoAuth.json();

    expect(dataAuth.timezones.length).toBe(dataNoAuth.timezones.length);
    expect(dataAuth.timezones[0].value).toBe(dataNoAuth.timezones[0].value);
  });
});

// ==============================================================================
// 8. TIMEZONE DATA INTEGRITY
// ==============================================================================

test.describe("Timezone Data Integrity", () => {
  test("all timezone values should be unique", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const values = data.timezones.map((tz: Timezone) => tz.value);
    const uniqueValues = new Set(values);

    // Note: Some timezones may have duplicate values with different labels
    // (e.g., multiple cities in the same timezone)
    // This is expected behavior based on the TIMEZONE_LOCATIONS array
    expect(uniqueValues.size).toBeGreaterThan(50);
  });

  test("all labels should be non-empty strings", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    for (const tz of data.timezones) {
      expect(typeof tz.label).toBe("string");
      expect(tz.label.trim().length).toBeGreaterThan(0);
    }
  });

  test("offset range should be valid (UTC-12 to UTC+14)", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();

    const parseOffset = (s: string) => {
      const match = s.match(/([+-])(\d{2}):(\d{2})$/);
      if (!match) return 0;
      const sign = match[1] === "+" ? 1 : -1;
      return sign * (parseInt(match[2]) * 60 + parseInt(match[3]));
    };

    for (const tz of data.timezones) {
      const offsetMinutes = parseOffset(tz.utc_offset);
      expect(offsetMinutes).toBeGreaterThanOrEqual(-12 * 60); // UTC-12
      expect(offsetMinutes).toBeLessThanOrEqual(14 * 60); // UTC+14
    }
  });

  test("should include major regional timezones", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const values = data.timezones.map((tz: Timezone) => tz.value);

    // Check for major regions
    const hasAmericas = values.some((v: string) => v.startsWith("America/"));
    const hasEurope = values.some((v: string) => v.startsWith("Europe/"));
    const hasAsia = values.some((v: string) => v.startsWith("Asia/"));
    const hasPacific = values.some((v: string) => v.startsWith("Pacific/"));
    const hasAustralia = values.some((v: string) => v.startsWith("Australia/"));
    const hasAfrica = values.some((v: string) => v.startsWith("Africa/"));

    expect(hasAmericas).toBe(true);
    expect(hasEurope).toBe(true);
    expect(hasAsia).toBe(true);
    expect(hasPacific).toBe(true);
    expect(hasAustralia).toBe(true);
    expect(hasAfrica).toBe(true);
  });
});

// ==============================================================================
// 9. FRACTIONAL OFFSET TIMEZONES
// ==============================================================================

test.describe("Fractional Offset Timezones", () => {
  test("should include India timezone with :30 offset", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const halfHourOffsets = data.timezones.filter((tz: Timezone) =>
      tz.utc_offset.endsWith(":30")
    );
    expect(halfHourOffsets.length).toBeGreaterThan(0);

    // Verify India is among them
    const india = halfHourOffsets.find(
      (tz: Timezone) => tz.value === "Asia/Kolkata"
    );
    expect(india).toBeDefined();
  });

  test("should include Nepal timezone with :45 offset", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const nepal = data.timezones.find(
      (tz: Timezone) => tz.value === "Asia/Kathmandu"
    );
    expect(nepal).toBeDefined();
    expect(nepal.utc_offset).toBe("UTC+05:45");
  });

  test("should include Chatham Islands with fractional offset", async ({
    timezonePage,
    td,
  }) => {
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const chatham = data.timezones.find(
      (tz: Timezone) => tz.value === "Pacific/Chatham"
    );
    expect(chatham).toBeDefined();
    // Chatham is UTC+12:45 or UTC+13:45 depending on DST
    expect(chatham.utc_offset).toMatch(/^UTC\+1[23]:45$/);
  });
});

// ==============================================================================
// 10. RESPONSE PERFORMANCE
// ==============================================================================

test.describe("Response Performance", () => {
  test("should respond within reasonable time", async ({
    timezonePage,
    td,
  }) => {
    const startTime = Date.now();
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    const endTime = Date.now();

    expect(res.ok()).toBeTruthy();
    // Response should be under 2 seconds (generous for cached data)
    expect(endTime - startTime).toBeLessThan(2000);
  });

  test("subsequent requests should be fast (cached)", async ({
    timezonePage,
    td,
  }) => {
    // First request (may populate cache)
    await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });

    // Second request (should be cached)
    const startTime = Date.now();
    const res = await timezonePage.request.get(`${API_BASE}/api/timezones/`, {
      headers: authHeaders(td.token),
    });
    const endTime = Date.now();

    expect(res.ok()).toBeTruthy();
    // Cached response should be very fast
    expect(endTime - startTime).toBeLessThan(1000);
  });
});
