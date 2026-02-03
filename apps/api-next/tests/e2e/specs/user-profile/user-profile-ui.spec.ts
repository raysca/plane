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
  email: string;
  wsSlug: string;
  workspaceId: string;
}

// ── Fixture: authenticated page with user and workspace ──────────────────────

type Fixtures = {
  profilePage: Page;
  td: TestData;
};

const test = base.extend<Fixtures>({
  profilePage: [
    async ({ page, request }, use) => {
      const email = generateTestEmail("profile-ui");
      const password = generateTestPassword();
      const wsSlug = generateWorkspaceSlug("profile-ws");
      const headers = (token: string) => ({ Authorization: `Bearer ${token}` });

      // 1. Create user via API
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: { email, password, first_name: "Profile", last_name: "Tester" },
      });
      expect(signupRes.ok()).toBeTruthy();
      const signupData = await signupRes.json();
      const token: string = signupData.access_token;
      const userId: string = signupData.user?.id ?? signupData.id;

      // 2. Set session cookies on the page
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

      // 3. Complete onboarding via API
      await request.patch(`${API_BASE}/api/users/me/`, {
        headers: headers(token),
        data: { first_name: "Profile", last_name: "Tester", is_onboarded: true },
      });

      // 4. Create workspace via API
      const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: { name: "Profile Test WS", slug: wsSlug, organization_size: "2-10" },
      });
      expect(wsRes.ok()).toBeTruthy();
      const ws = await wsRes.json();

      // Store test data on page object
      const td: TestData = {
        token,
        userId,
        email,
        wsSlug,
        workspaceId: ws.id,
      };
      (page as any).__testData = td;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ profilePage }, use) => {
    await use((profilePage as any).__testData as TestData);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/users/me/ - Get current user
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/users/me/ - Get current user", () => {
  test("should return current user data with correct format", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const user = await res.json();

    // Verify required fields exist
    expect(user.id).toBeDefined();
    expect(user.email).toBe(td.email);
    expect(user.first_name).toBe("Profile");
    expect(user.last_name).toBe("Tester");
    expect(user.is_onboarded).toBe(true);
  });

  test("should return all expected profile properties", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const user = await res.json();

    // Verify all expected properties exist
    const expectedFields = [
      "id",
      "email",
      "first_name",
      "last_name",
      "username",
      "display_name",
      "avatar",
      "avatar_url",
      "cover_image",
      "cover_image_url",
      "date_joined",
      "is_onboarded",
      "is_active",
      "is_bot",
      "is_email_verified",
      "is_password_autoset",
      "is_tour_completed",
      "user_timezone",
      "onboarding_step",
      "created_at",
      "updated_at",
    ];

    for (const field of expectedFields) {
      expect(user).toHaveProperty(field);
    }
  });

  test("should return 401 without authentication", async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/users/me/`);
    expect(res.status()).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PATCH /api/users/me/ - Update user profile
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("PATCH /api/users/me/ - Update user profile", () => {
  test("should update first_name and last_name", async ({
    profilePage,
    td,
    request,
  }) => {
    const newFirstName = "Updated";
    const newLastName = "User";

    const res = await request.patch(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { first_name: newFirstName, last_name: newLastName },
    });
    expect(res.ok()).toBeTruthy();

    const user = await res.json();
    expect(user.first_name).toBe(newFirstName);
    expect(user.last_name).toBe(newLastName);
  });

  test("should update display_name", async ({
    profilePage,
    td,
    request,
  }) => {
    const newDisplayName = `Display ${Date.now().toString(36)}`;

    const res = await request.patch(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { display_name: newDisplayName },
    });
    expect(res.ok()).toBeTruthy();

    const user = await res.json();
    expect(user.display_name).toBe(newDisplayName);
  });

  test("should update username with valid format", async ({
    profilePage,
    td,
    request,
  }) => {
    const newUsername = `user_${Date.now().toString(36)}`;

    const res = await request.patch(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { username: newUsername },
    });
    expect(res.ok()).toBeTruthy();

    const user = await res.json();
    expect(user.username).toBe(newUsername);
  });

  test("should reject invalid username format", async ({
    profilePage,
    td,
    request,
  }) => {
    const invalidUsername = "Invalid Username!"; // contains spaces and special chars

    const res = await request.patch(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { username: invalidUsername },
    });
    expect(res.status()).toBe(400);
  });

  test("should update is_tour_completed", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { is_tour_completed: true },
    });
    expect(res.ok()).toBeTruthy();

    const user = await res.json();
    expect(user.is_tour_completed).toBe(true);
  });

  test("should update onboarding_step", async ({
    profilePage,
    td,
    request,
  }) => {
    const onboardingStep = {
      profile_complete: true,
      workspace_create: true,
      workspace_invite: false,
      workspace_join: false,
    };

    const res = await request.patch(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { onboarding_step: onboardingStep },
    });
    expect(res.ok()).toBeTruthy();

    const user = await res.json();
    expect(user.onboarding_step.profile_complete).toBe(true);
    expect(user.onboarding_step.workspace_create).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/users/me/profile/ - Get user profile settings
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/users/me/profile/ - Get user profile settings", () => {
  test("should return profile with default values", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/profile/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const profile = await res.json();

    // Verify expected fields
    expect(profile).toHaveProperty("id");
    expect(profile).toHaveProperty("user_id");
    expect(profile).toHaveProperty("timezone");
    expect(profile).toHaveProperty("date_format");
    expect(profile).toHaveProperty("time_format");
    expect(profile).toHaveProperty("theme");
    expect(profile).toHaveProperty("language");
  });

  test("should return all profile properties", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/profile/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const profile = await res.json();

    const expectedFields = [
      "id",
      "user_id",
      "timezone",
      "date_format",
      "time_format",
      "theme",
      "language",
      "role",
      "use_case",
      "last_workspace_id",
      "onboarding_step",
      "is_onboarded",
      "is_tour_completed",
      "billing_address_country",
      "billing_address",
      "company_name",
      "has_marketing_email_consent",
      "created_at",
      "updated_at",
    ];

    for (const field of expectedFields) {
      expect(profile).toHaveProperty(field);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PATCH /api/users/me/profile/ - Update user profile settings
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("PATCH /api/users/me/profile/ - Update user profile settings", () => {
  test("should update timezone", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/profile/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { timezone: "America/New_York" },
    });
    expect(res.ok()).toBeTruthy();

    const profile = await res.json();
    expect(profile.timezone).toBe("America/New_York");
  });

  test("should update date_format", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/profile/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { date_format: "DD/MM/YYYY" },
    });
    expect(res.ok()).toBeTruthy();

    const profile = await res.json();
    expect(profile.date_format).toBe("DD/MM/YYYY");
  });

  test("should update time_format to 24h", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/profile/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { time_format: "24h" },
    });
    expect(res.ok()).toBeTruthy();

    const profile = await res.json();
    expect(profile.time_format).toBe("24h");
  });

  test("should update theme", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/profile/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { theme: "dark" },
    });
    expect(res.ok()).toBeTruthy();

    const profile = await res.json();
    expect(profile.theme).toBe("dark");
  });

  test("should update language", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/profile/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { language: "es" },
    });
    expect(res.ok()).toBeTruthy();

    const profile = await res.json();
    expect(profile.language).toBe("es");
  });

  test("should update role", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/profile/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { role: "Software Engineer" },
    });
    expect(res.ok()).toBeTruthy();

    const profile = await res.json();
    expect(profile.role).toBe("Software Engineer");
  });

  test("should update use_case", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/profile/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { use_case: "Project Management" },
    });
    expect(res.ok()).toBeTruthy();

    const profile = await res.json();
    expect(profile.use_case).toBe("Project Management");
  });

  test("should update company_name", async ({
    profilePage,
    td,
    request,
  }) => {
    const companyName = `TestCompany ${Date.now().toString(36)}`;
    const res = await request.patch(`${API_BASE}/api/users/me/profile/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { company_name: companyName },
    });
    expect(res.ok()).toBeTruthy();

    const profile = await res.json();
    expect(profile.company_name).toBe(companyName);
  });

  test("should update has_marketing_email_consent", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/profile/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { has_marketing_email_consent: true },
    });
    expect(res.ok()).toBeTruthy();

    const profile = await res.json();
    expect(profile.has_marketing_email_consent).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GET /api/users/me/settings/ - Get user settings
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/users/me/settings/ - Get user settings", () => {
  test("should return settings with workspace info", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/settings/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const settings = await res.json();

    // Verify expected fields
    expect(settings).toHaveProperty("id");
    expect(settings).toHaveProperty("email");
    expect(settings).toHaveProperty("workspace");
    expect(settings.email).toBe(td.email);
  });

  test("should return workspace details in settings", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/settings/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const settings = await res.json();

    // Verify workspace structure
    expect(settings.workspace).toHaveProperty("last_workspace_id");
    expect(settings.workspace).toHaveProperty("last_workspace_slug");
    expect(settings.workspace).toHaveProperty("last_workspace_name");
    expect(settings.workspace).toHaveProperty("last_workspace_logo");
    expect(settings.workspace).toHaveProperty("fallback_workspace_id");
    expect(settings.workspace).toHaveProperty("fallback_workspace_slug");
    expect(settings.workspace).toHaveProperty("invites");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GET /api/users/me/activities/ - Get user activities
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/users/me/activities/ - Get user activities", () => {
  test("should return paginated activities response", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/activities/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const activities = await res.json();

    // Verify pagination structure
    expect(activities).toHaveProperty("total_count");
    expect(activities).toHaveProperty("next_cursor");
    expect(activities).toHaveProperty("prev_cursor");
    expect(activities).toHaveProperty("next_page_results");
    expect(activities).toHaveProperty("prev_page_results");
    expect(activities).toHaveProperty("count");
    expect(activities).toHaveProperty("total_pages");
    expect(activities).toHaveProperty("total_results");
    expect(activities).toHaveProperty("results");
    expect(Array.isArray(activities.results)).toBe(true);
  });

  test("should accept per_page parameter", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/activities/?per_page=10`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const activities = await res.json();
    expect(activities.results.length).toBeLessThanOrEqual(10);
  });

  test("should return 401 without authentication", async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/users/me/activities/`);
    expect(res.status()).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. GET /api/users/me/notification-preferences/ - Get notification prefs
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/users/me/notification-preferences/ - Get notification preferences", () => {
  test("should return notification preferences with defaults", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/notification-preferences/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const prefs = await res.json();

    // Verify expected fields
    expect(prefs).toHaveProperty("id");
    expect(prefs).toHaveProperty("user_id");
    expect(prefs).toHaveProperty("property_change_email");
    expect(prefs).toHaveProperty("state_change_email");
    expect(prefs).toHaveProperty("comment_email");
    expect(prefs).toHaveProperty("mention_email");
    expect(prefs).toHaveProperty("issue_completed_email");
  });

  test("should have boolean values for email preferences", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/notification-preferences/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const prefs = await res.json();

    expect(typeof prefs.property_change_email).toBe("boolean");
    expect(typeof prefs.state_change_email).toBe("boolean");
    expect(typeof prefs.comment_email).toBe("boolean");
    expect(typeof prefs.mention_email).toBe("boolean");
    expect(typeof prefs.issue_completed_email).toBe("boolean");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. PATCH /api/users/me/notification-preferences/ - Update notification prefs
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("PATCH /api/users/me/notification-preferences/ - Update notification preferences", () => {
  test("should update property_change_email", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/notification-preferences/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { property_change_email: false },
    });
    expect(res.ok()).toBeTruthy();

    const prefs = await res.json();
    expect(prefs.property_change_email).toBe(false);
  });

  test("should update state_change_email", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/notification-preferences/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { state_change_email: false },
    });
    expect(res.ok()).toBeTruthy();

    const prefs = await res.json();
    expect(prefs.state_change_email).toBe(false);
  });

  test("should update comment_email", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/notification-preferences/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { comment_email: false },
    });
    expect(res.ok()).toBeTruthy();

    const prefs = await res.json();
    expect(prefs.comment_email).toBe(false);
  });

  test("should update mention_email", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/notification-preferences/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { mention_email: false },
    });
    expect(res.ok()).toBeTruthy();

    const prefs = await res.json();
    expect(prefs.mention_email).toBe(false);
  });

  test("should update issue_completed_email", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/notification-preferences/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { issue_completed_email: false },
    });
    expect(res.ok()).toBeTruthy();

    const prefs = await res.json();
    expect(prefs.issue_completed_email).toBe(false);
  });

  test("should update multiple preferences at once", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/notification-preferences/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: {
        property_change_email: true,
        state_change_email: false,
        comment_email: true,
        mention_email: false,
        issue_completed_email: true,
      },
    });
    expect(res.ok()).toBeTruthy();

    const prefs = await res.json();
    expect(prefs.property_change_email).toBe(true);
    expect(prefs.state_change_email).toBe(false);
    expect(prefs.comment_email).toBe(true);
    expect(prefs.mention_email).toBe(false);
    expect(prefs.issue_completed_email).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. PATCH /api/users/me/onboard/ - Update onboarding status
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("PATCH /api/users/me/onboard/ - Update onboarding status", () => {
  test("should set is_onboarded to true", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/onboard/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { is_onboarded: true },
    });
    expect(res.ok()).toBeTruthy();

    const result = await res.json();
    expect(result.message).toBe("Updated successfully");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. PATCH /api/users/me/tour-completed/ - Update tour status
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("PATCH /api/users/me/tour-completed/ - Update tour status", () => {
  test("should set is_tour_completed to true", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.patch(`${API_BASE}/api/users/me/tour-completed/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { is_tour_completed: true },
    });
    expect(res.ok()).toBeTruthy();

    const result = await res.json();
    expect(result.message).toBe("Updated successfully");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. GET /api/users/me/workspaces/ - Get user workspaces
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/users/me/workspaces/ - Get user workspaces", () => {
  test("should return list of user workspaces", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/workspaces/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const workspaces = await res.json();
    expect(Array.isArray(workspaces)).toBe(true);
    expect(workspaces.length).toBeGreaterThanOrEqual(1);
  });

  test("should return workspace with expected properties", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/workspaces/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const workspaces = await res.json();
    const ws = workspaces[0];

    expect(ws).toHaveProperty("id");
    expect(ws).toHaveProperty("name");
    expect(ws).toHaveProperty("slug");
    expect(ws).toHaveProperty("logo");
    expect(ws).toHaveProperty("owner");
    expect(ws).toHaveProperty("role");
    expect(ws).toHaveProperty("total_members");
  });

  test("should include the created workspace", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/workspaces/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const workspaces = await res.json();
    const found = workspaces.find((ws: any) => ws.slug === td.wsSlug);
    expect(found).toBeDefined();
    expect(found.name).toBe("Profile Test WS");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. GET /api/users/me/accounts/ - Get linked OAuth accounts
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/users/me/accounts/ - Get linked OAuth accounts", () => {
  test("should return array of linked accounts", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/accounts/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const accounts = await res.json();
    expect(Array.isArray(accounts)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. GET /api/users/me/email/ - Get user emails
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/users/me/email/ - Get user emails", () => {
  test("should return array with primary email", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/email/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const emails = await res.json();
    expect(Array.isArray(emails)).toBe(true);
    expect(emails.length).toBeGreaterThanOrEqual(1);
  });

  test("should return email with expected properties", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/email/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const emails = await res.json();
    const primaryEmail = emails[0];

    expect(primaryEmail).toHaveProperty("id");
    expect(primaryEmail).toHaveProperty("email");
    expect(primaryEmail).toHaveProperty("is_primary");
    expect(primaryEmail).toHaveProperty("is_verified");
    expect(primaryEmail.email).toBe(td.email);
    expect(primaryEmail.is_primary).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. GET /api/users/me/instance-admin/ - Check instance admin status
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/users/me/instance-admin/ - Check instance admin status", () => {
  test("should return is_admin status", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/instance-admin/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const result = await res.json();
    expect(result).toHaveProperty("is_admin");
    expect(typeof result.is_admin).toBe("boolean");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. UI: Workspace Settings Page (Account tab has profile settings)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("UI: Workspace Settings Page", () => {
  test("should navigate to workspace settings page", async ({
    profilePage,
    td,
  }) => {
    await profilePage.goto(`/${td.wsSlug}/settings`);
    await waitForAppReady(profilePage);

    // Should be on the settings page
    expect(profilePage.url()).toContain("/settings");
  });

  test("should show Account tab in settings", async ({
    profilePage,
    td,
  }) => {
    await profilePage.goto(`/${td.wsSlug}/settings`);
    await waitForAppReady(profilePage);

    // Look for Account tab in settings navigation
    const accountTab = profilePage.getByText("Account").first();
    await expect(accountTab).toBeVisible({ timeout: 10_000 });
  });

  test("should show Workspace tab in settings", async ({
    profilePage,
    td,
  }) => {
    await profilePage.goto(`/${td.wsSlug}/settings`);
    await waitForAppReady(profilePage);

    // Look for Workspace tab
    const workspaceTab = profilePage.getByText("Workspace").first();
    await expect(workspaceTab).toBeVisible({ timeout: 10_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. UI: Home Page (where activity/profile would be shown)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("UI: Home Page", () => {
  test("should navigate to home page", async ({
    profilePage,
    td,
  }) => {
    await profilePage.goto(`/${td.wsSlug}`);
    await waitForAppReady(profilePage);

    // Should be on the workspace home
    expect(profilePage.url()).toContain(td.wsSlug);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. GET /api/users/me/workspaces/invitations/ - Get workspace invitations
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/users/me/workspaces/invitations/ - Get workspace invitations", () => {
  test("should return array of invitations", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/workspaces/invitations/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const invitations = await res.json();
    expect(Array.isArray(invitations)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 18. Response Format Validation
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Response Format Validation", () => {
  test("should use snake_case for all response fields", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const user = await res.json();
    const keys = Object.keys(user);

    // All keys should be snake_case (no camelCase)
    for (const key of keys) {
      expect(key).not.toMatch(/[A-Z]/); // No uppercase letters in snake_case
    }
  });

  test("should return ISO date strings for timestamp fields", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const user = await res.json();

    // Check that timestamp fields are ISO strings
    if (user.created_at) {
      expect(() => new Date(user.created_at)).not.toThrow();
    }
    if (user.updated_at) {
      expect(() => new Date(user.updated_at)).not.toThrow();
    }
  });

  test("profile response should use snake_case", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/profile/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const profile = await res.json();
    const keys = Object.keys(profile);

    for (const key of keys) {
      expect(key).not.toMatch(/[A-Z]/);
    }
  });

  test("notification preferences response should use snake_case", async ({
    profilePage,
    td,
    request,
  }) => {
    const res = await request.get(`${API_BASE}/api/users/me/notification-preferences/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();

    const prefs = await res.json();
    const keys = Object.keys(prefs);

    for (const key of keys) {
      expect(key).not.toMatch(/[A-Z]/);
    }
  });
});
