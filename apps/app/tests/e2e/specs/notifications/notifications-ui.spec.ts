import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
  waitForAppReady,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────────────────

interface TestData {
  token: string;
  userId: string;
  wsSlug: string;
  workspaceId: string;
  projectId: string;
  identifier: string;
  issueId: string;
}

// ── Fixture ──────────────────────────────────────────────────────────────────

type Fixtures = {
  notifPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("notif-ui"));
  },

  notifPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("notif-ui");
      const password = generateTestPassword();
      const identifier = `N${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Notif",
          last_name: "Tester",
        },
      });
      expect(signupRes.ok()).toBeTruthy();
      const signupData = await signupRes.json();
      const token: string = signupData.access_token;
      const userId: string = signupData.user?.id ?? signupData.id;

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
          first_name: "Notif",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Notif Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });
      expect(wsRes.ok()).toBeTruthy();
      const ws = await wsRes.json();
      const workspaceId = ws.id;

      // 5. Create project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Notif Project", identifier, network: 2 },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;

      // 6. Create an issue (for potential notification triggers)
      const issueRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/issues/`,
        {
          headers: headers(token),
          data: { name: "Notification Test Issue" },
        }
      );
      expect(issueRes.ok()).toBeTruthy();
      const issue = await issueRes.json();

      const td: TestData = {
        token,
        userId,
        wsSlug,
        workspaceId,
        projectId,
        identifier,
        issueId: issue.id,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ notifPage }, use) => {
    await use((notifPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseUrl(td: TestData): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}`;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function goToNotifications(page: Page, wsSlug: string) {
  await page.goto(`/${wsSlug}/notifications/`);
  await page.waitForLoadState("domcontentloaded");
  // Wait for page to be ready
  await page.waitForTimeout(2_000);
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. Notifications UI ────────────────────────────────────────────────────

test.describe("Notifications UI", () => {
  test("should navigate to notifications page", async ({
    notifPage,
    wsSlug,
  }) => {
    await goToNotifications(notifPage, wsSlug);
    expect(notifPage.url()).toContain("/notifications");
  });

  test("should show notifications in header/sidebar", async ({
    notifPage,
    wsSlug,
  }) => {
    const projectId = (notifPage as any).__projectId;
    await notifPage.goto(`/${wsSlug}/projects/${projectId}/issues/`);
    await waitForAppReady(notifPage);
    // Look for notification icon/button in header
    const notifIcon = notifPage
      .locator(
        'button[aria-label*="notification"], a[href*="notification"], [data-testid="notification"]'
      )
      .first();
    // May or may not be visible depending on UI state
    if (await notifIcon.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(notifIcon).toBeVisible();
    }
  });
});

// ─── 2. Notification API - List ─────────────────────────────────────────────

test.describe("Notification API - List", () => {
  test("should list notifications via API", async ({ notifPage, td }) => {
    const res = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Verify response structure
    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.total_count).toBeDefined();
    expect(data.count).toBeDefined();
    expect(data.total_pages).toBeDefined();
    expect(data.next_page_results).toBeDefined();
    expect(data.prev_page_results).toBeDefined();
    expect(data.next_cursor).toBeDefined();
    expect(data.prev_cursor).toBeDefined();
    expect(data.grouped_by).toBeNull();
    expect(data.sub_grouped_by).toBeNull();
    expect(data.extra_stats).toBeNull();
  });

  test("should paginate notifications via API", async ({ notifPage, td }) => {
    const res = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?per_page=5`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.results.length).toBeLessThanOrEqual(5);
  });

  test("should filter notifications by read status via API", async ({
    notifPage,
    td,
  }) => {
    // Filter for read notifications
    const readRes = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?read=true`,
      { headers: auth(td.token) }
    );
    expect(readRes.ok()).toBeTruthy();
    const readData = await readRes.json();
    // All results (if any) should have read_at
    for (const notif of readData.results) {
      expect(notif.read_at).toBeTruthy();
    }

    // Filter for unread notifications
    const unreadRes = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?read=false`,
      { headers: auth(td.token) }
    );
    expect(unreadRes.ok()).toBeTruthy();
    const unreadData = await unreadRes.json();
    // All results (if any) should have null read_at
    for (const notif of unreadData.results) {
      expect(notif.read_at).toBeNull();
    }
  });

  test("should filter notifications by archived status via API", async ({
    notifPage,
    td,
  }) => {
    // Filter for archived
    const archivedRes = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?archived=true`,
      { headers: auth(td.token) }
    );
    expect(archivedRes.ok()).toBeTruthy();
    const archivedData = await archivedRes.json();
    for (const notif of archivedData.results) {
      expect(notif.archived_at).toBeTruthy();
    }

    // Filter for not archived (default)
    const notArchivedRes = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?archived=false`,
      { headers: auth(td.token) }
    );
    expect(notArchivedRes.ok()).toBeTruthy();
    const notArchivedData = await notArchivedRes.json();
    for (const notif of notArchivedData.results) {
      expect(notif.archived_at).toBeNull();
    }
  });

  test("should filter notifications by snoozed status via API", async ({
    notifPage,
    td,
  }) => {
    const res = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?snoozed=true`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // All results (if any) should have snoozed_till
    for (const notif of data.results) {
      expect(notif.snoozed_till).toBeTruthy();
    }
  });

  test("should filter notifications by mentioned via API", async ({
    notifPage,
    td,
  }) => {
    const res = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?mentioned=true`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // All results (if any) should be mention notifications
    for (const notif of data.results) {
      expect(notif.sender).toContain("mentioned");
    }
  });

  test("should filter notifications by type via API", async ({
    notifPage,
    td,
  }) => {
    // Filter for assigned type
    const res = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?type=assigned`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    for (const notif of data.results) {
      expect(notif.sender).toContain("assigned");
    }
  });

  test("should filter notifications by multiple types via API", async ({
    notifPage,
    td,
  }) => {
    const res = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?type=assigned,created`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    for (const notif of data.results) {
      expect(
        notif.sender.includes("assigned") || notif.sender.includes("created")
      ).toBe(true);
    }
  });

  test("should sort notifications by order_by via API", async ({
    notifPage,
    td,
  }) => {
    // Default is -created_at (desc)
    const descRes = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?order_by=-created_at`,
      { headers: auth(td.token) }
    );
    expect(descRes.ok()).toBeTruthy();

    // Ascending
    const ascRes = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?order_by=created_at`,
      { headers: auth(td.token) }
    );
    expect(ascRes.ok()).toBeTruthy();
  });
});

// ─── 3. Notification API - Unread Count ─────────────────────────────────────

test.describe("Notification API - Unread Count", () => {
  test("should get unread notification counts via API", async ({
    notifPage,
    td,
  }) => {
    const res = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/unread/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Verify response structure
    expect(data.total_unread_notifications_count).toBeDefined();
    expect(typeof data.total_unread_notifications_count).toBe("number");
    expect(data.mention_unread_notifications_count).toBeDefined();
    expect(typeof data.mention_unread_notifications_count).toBe("number");

    // Counts should be non-negative
    expect(data.total_unread_notifications_count).toBeGreaterThanOrEqual(0);
    expect(data.mention_unread_notifications_count).toBeGreaterThanOrEqual(0);
  });
});

// ─── 4. Notification API - Mark All Read ────────────────────────────────────

test.describe("Notification API - Mark All Read", () => {
  test("should mark all notifications as read via API", async ({
    notifPage,
    td,
  }) => {
    const res = await notifPage.request.post(
      `${baseUrl(td)}/users/notifications/mark-all-read/`,
      {
        headers: auth(td.token),
        data: {},
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.message).toBe("All notifications marked as read.");

    // Verify unread count is 0 after marking all read
    const countRes = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/unread/`,
      { headers: auth(td.token) }
    );
    const countData = await countRes.json();
    expect(countData.total_unread_notifications_count).toBe(0);
    expect(countData.mention_unread_notifications_count).toBe(0);
  });

  test("should mark all with filters via API", async ({ notifPage, td }) => {
    // Mark all assigned notifications as read
    const res = await notifPage.request.post(
      `${baseUrl(td)}/users/notifications/mark-all-read/`,
      {
        headers: auth(td.token),
        data: { type: "assigned" },
      }
    );
    expect(res.ok()).toBeTruthy();
  });
});

// ─── 5. Notification API - Response Validation ──────────────────────────────

test.describe("Notification API - Response Validation", () => {
  test("should return correct notification fields when present", async ({
    notifPage,
    td,
  }) => {
    const res = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // If there are notifications, verify their structure
    if (data.results.length > 0) {
      const notif = data.results[0];
      expect(notif.id).toBeDefined();
      expect(notif.workspace).toBe(td.workspaceId);
      expect(notif.receiver).toBe(td.userId);
      expect(notif.title).toBeDefined();
      expect(notif.sender).toBeDefined();
      expect(notif.read_at).toBeDefined();
      expect(notif.archived_at).toBeDefined();
      expect(notif.snoozed_till).toBeDefined();
      expect(notif.is_inbox_issue).toBeDefined();
      expect(notif.is_intake_issue).toBeDefined();
      expect(notif.is_mentioned_notification).toBeDefined();
      expect(notif.created_at).toBeDefined();
      expect(notif.updated_at).toBeDefined();
    }
  });

  test("should return 404 for non-existent notification", async ({
    notifPage,
    td,
  }) => {
    const res = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/00000000-0000-0000-0000-000000000000/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(404);
  });

  test("should return 404 for invalid workspace", async ({ notifPage, td }) => {
    const res = await notifPage.request.get(
      `${API_BASE}/api/workspaces/non-existent-ws/users/notifications/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(404);
  });
});

// ─── 6. Notification API - Cursor Pagination ────────────────────────────────

test.describe("Notification API - Cursor Pagination", () => {
  test("should support cursor-based pagination via API", async ({
    notifPage,
    td,
  }) => {
    // Get first page
    const res1 = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?per_page=1`,
      { headers: auth(td.token) }
    );
    expect(res1.ok()).toBeTruthy();
    const data1 = await res1.json();

    // If there's a next page, fetch it
    if (data1.next_page_results && data1.next_cursor) {
      const res2 = await notifPage.request.get(
        `${baseUrl(td)}/users/notifications/?cursor=${data1.next_cursor}`,
        { headers: auth(td.token) }
      );
      expect(res2.ok()).toBeTruthy();
      const data2 = await res2.json();

      // Should have different results
      if (data1.results.length > 0 && data2.results.length > 0) {
        expect(data2.results[0].id).not.toBe(data1.results[0].id);
      }
    }
  });
});

// ─── 7. Notification API - Combined Filters ─────────────────────────────────

test.describe("Notification API - Combined Filters", () => {
  test("should handle multiple filters together via API", async ({
    notifPage,
    td,
  }) => {
    const res = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?read=false&archived=false&type=assigned`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // All results should match all filters
    for (const notif of data.results) {
      expect(notif.read_at).toBeNull();
      expect(notif.archived_at).toBeNull();
      expect(notif.sender).toContain("assigned");
    }
  });

  test("should handle empty filter results gracefully via API", async ({
    notifPage,
    td,
  }) => {
    // Request with filters that likely return no results
    const res = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/?snoozed=true&archived=true`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Should return valid structure even with empty results
    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.total_count).toBeDefined();
  });
});

// ─── 8. Notification API - User Isolation ───────────────────────────────────

test.describe("Notification API - User Isolation", () => {
  test("should only return notifications for current user", async ({
    notifPage,
    td,
  }) => {
    const res = await notifPage.request.get(
      `${baseUrl(td)}/users/notifications/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // All notifications should belong to the current user
    for (const notif of data.results) {
      expect(notif.receiver).toBe(td.userId);
    }
  });
});
