import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
  waitForAppReady,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// Role constants matching the API
const ROLES = {
  GUEST: 5,
  VIEWER: 10,
  MEMBER: 15,
  ADMIN: 20,
} as const;

// ── Fixture Types ──────────────────────────────────────────────────────────
type Fixtures = {
  invPage: Page;
  wsSlug: string;
};

// ── Test Data Interface ────────────────────────────────────────────────────
interface TestData {
  token: string;
  userId: string;
  email: string;
  workspaceId: string;
  wsSlug: string;
}

// ── Helper: get test data from page ────────────────────────────────────────
function getTestData(page: Page): TestData {
  return (page as any).__testData;
}

// ── Main Fixture: authenticated admin user with workspace ──────────────────
const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("inv-ui"));
  },

  invPage: async ({ page, request, wsSlug }, use) => {
    const email = generateTestEmail("inv-ui");
    const password = generateTestPassword();

    // 1. Create user via API
    const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "Invitation", last_name: "Admin" },
    });
    expect(signupRes.ok()).toBeTruthy();
    const signupData = await signupRes.json();
    const token = signupData.access_token;

    // 2. Set session cookies on the page
    const cookies = signupRes
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value);

    for (const cookie of cookies) {
      const parts = cookie.split(";")[0]!.split("=");
      const name = parts[0]!.trim();
      const value = parts.slice(1).join("=").trim();
      await page.context().addCookies([
        { name, value, domain: "localhost", path: "/" },
      ]);
    }

    // 3. Complete onboarding via API
    await request.patch(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { first_name: "Invitation", last_name: "Admin", is_onboarded: true },
    });

    // 4. Create workspace via API
    const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Invitation Test WS", slug: wsSlug, organization_size: "2-10" },
    });
    expect(wsRes.ok()).toBeTruthy();
    const workspace = await wsRes.json();

    // 5. Get user info
    const meRes = await request.get(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await meRes.json();

    // Store test data in page for tests to use
    (page as any).__testData = {
      token,
      userId: me.id,
      email,
      workspaceId: workspace.id,
      wsSlug,
    } as TestData;

    await use(page);
  },
});

// ---------------------------------------------------------------------------
// Helper: API request with auth
// ---------------------------------------------------------------------------
async function apiRequest(
  request: any,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  token: string,
  data?: any
) {
  const options: any = {
    headers: { Authorization: `Bearer ${token}` },
  };
  if (data) {
    options.data = data;
  }

  switch (method) {
    case "GET":
      return request.get(`${API_BASE}${path}`, options);
    case "POST":
      return request.post(`${API_BASE}${path}`, options);
    case "PATCH":
      return request.patch(`${API_BASE}${path}`, options);
    case "DELETE":
      return request.delete(`${API_BASE}${path}`, options);
  }
}

// ---------------------------------------------------------------------------
// Helper: Direct fetch API request (no Playwright context - avoids cookie conflicts)
// Can authenticate via Bearer token or session cookie
// ---------------------------------------------------------------------------
async function directApiRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  auth: string,  // Either a Bearer token or session cookie
  data?: any
): Promise<{ status: () => number; json: () => Promise<any>; ok: () => boolean; text: () => Promise<string> }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // If auth contains "=" it's likely a cookie, otherwise treat as Bearer token
  if (auth.includes("=")) {
    headers["Cookie"] = auth;
  } else {
    headers["Authorization"] = `Bearer ${auth}`;
  }

  const options: RequestInit = { method, headers };
  if (data) {
    options.body = JSON.stringify(data);
  }

  const res = await fetch(`${API_BASE}${path}`, options);

  return {
    status: () => res.status,
    ok: () => res.ok,
    json: () => res.json(),
    text: () => res.text(),
  };
}

// ---------------------------------------------------------------------------
// Helper: Create a new user and get their session cookie
// Uses fetch directly to avoid polluting the shared request context
// Returns the session cookie for use with directApiRequest
// ---------------------------------------------------------------------------
async function createUserAndGetSession(
  emailPrefix: string
): Promise<{ email: string; sessionCookie: string }> {
  const email = generateTestEmail(emailPrefix);
  const password = generateTestPassword();

  // Use native fetch to avoid affecting the shared request context
  const signupRes = await fetch(`${API_BASE}/auth/sign-up/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, first_name: "Test", last_name: "User" }),
  });

  if (!signupRes.ok) {
    throw new Error(`Failed to create user: ${await signupRes.text()}`);
  }

  // Extract session cookie from Set-Cookie header
  const setCookieHeaders = signupRes.headers.getSetCookie();
  const sessionCookie = setCookieHeaders
    .map(c => c.split(";")[0])  // Get just the cookie name=value part
    .join("; ");

  return { email, sessionCookie };
}

// ---------------------------------------------------------------------------
// Create Invitation Tests
// ---------------------------------------------------------------------------
test.describe("Create Invitation (POST /api/workspaces/:slug/invitations/)", () => {
  test("should create a single invitation with member role", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const inviteeEmail = generateTestEmail("invitee");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: inviteeEmail, role: ROLES.MEMBER }],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].email).toBe(inviteeEmail.toLowerCase());
    expect(data[0].role).toBe(ROLES.MEMBER);
    expect(data[0].id).toBeDefined();
    expect(data[0].accepted).toBe(null);
    expect(data[0].responded_at).toBe(null);
  });

  test("should create multiple invitations at once", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const email1 = generateTestEmail("batch1");
    const email2 = generateTestEmail("batch2");
    const email3 = generateTestEmail("batch3");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [
          { email: email1, role: ROLES.ADMIN },
          { email: email2, role: ROLES.MEMBER },
          { email: email3, role: ROLES.GUEST },
        ],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(3);

    // Verify different roles
    const emails = data.map((inv: any) => inv.email);
    expect(emails).toContain(email1.toLowerCase());
    expect(emails).toContain(email2.toLowerCase());
    expect(emails).toContain(email3.toLowerCase());
  });

  test("should create invitation with admin role", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const adminEmail = generateTestEmail("admin-invite");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: adminEmail, role: ROLES.ADMIN }],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data[0].role).toBe(ROLES.ADMIN);
  });

  test("should create invitation with guest role", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const guestEmail = generateTestEmail("guest-invite");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: guestEmail, role: ROLES.GUEST }],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data[0].role).toBe(ROLES.GUEST);
  });

  test("should create invitation with viewer role", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const viewerEmail = generateTestEmail("viewer-invite");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: viewerEmail, role: ROLES.VIEWER }],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data[0].role).toBe(ROLES.VIEWER);
  });

  test("should include optional message in invitation", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const inviteeEmail = generateTestEmail("msg-invite");
    const message = "Welcome to our workspace!";

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: inviteeEmail, role: ROLES.MEMBER }],
        message,
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data[0].message).toBe(message);
  });

  test("should normalize email to lowercase", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const mixedCaseEmail = `MixedCase-${Date.now()}@TEST.LOCAL`;

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: mixedCaseEmail, role: ROLES.MEMBER }],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data[0].email).toBe(mixedCaseEmail.toLowerCase());
  });

  test("should return correct response format", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const inviteeEmail = generateTestEmail("format-test");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: inviteeEmail, role: ROLES.MEMBER }],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    const invitation = data[0];

    // Verify all expected fields are present
    expect(invitation).toHaveProperty("id");
    expect(invitation).toHaveProperty("email");
    expect(invitation).toHaveProperty("role");
    expect(invitation).toHaveProperty("message");
    expect(invitation).toHaveProperty("accepted");
    expect(invitation).toHaveProperty("responded_at");
    expect(invitation).toHaveProperty("created_by_id");
    expect(invitation).toHaveProperty("created_at");
    expect(invitation).toHaveProperty("updated_at");
  });
});

// ---------------------------------------------------------------------------
// Create Invitation Error Cases
// ---------------------------------------------------------------------------
test.describe("Create Invitation Error Cases", () => {
  test("should reject invalid email format", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: "not-an-email", role: ROLES.MEMBER }],
      }
    );

    expect(res.status()).toBe(400);
  });

  test("should reject invalid role value", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const inviteeEmail = generateTestEmail("invalid-role");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: inviteeEmail, role: 99 }],
      }
    );

    expect(res.status()).toBe(400);
  });

  test("should reject empty emails array", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [],
      }
    );

    expect(res.status()).toBe(400);
  });

  test("should reject invitation for existing workspace member", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token, email } = getTestData(invPage);

    // Try to invite the admin user who is already a member
    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email, role: ROLES.MEMBER }],
      }
    );

    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("already member");
  });

  test("should skip duplicate pending invitation (not error)", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const duplicateEmail = generateTestEmail("duplicate");

    // Create first invitation
    const res1 = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: duplicateEmail, role: ROLES.MEMBER }],
      }
    );
    expect(res1.status()).toBe(201);

    // Try to create duplicate invitation
    const res2 = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: duplicateEmail, role: ROLES.MEMBER }],
      }
    );
    expect(res2.status()).toBe(201);
    const data = await res2.json();
    // Should return empty array (skipped duplicate)
    expect(data.length).toBe(0);
  });

  test("should return 401 for unauthenticated request", async ({
    wsSlug,
    request,
  }) => {
    const inviteeEmail = generateTestEmail("unauth");

    const res = await request.post(
      `${API_BASE}/api/workspaces/${wsSlug}/invitations/`,
      {
        data: {
          emails: [{ email: inviteeEmail, role: ROLES.MEMBER }],
        },
      }
    );

    expect(res.status()).toBe(401);
  });

  test("should return 404 for non-existent workspace", async ({
    invPage,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const inviteeEmail = generateTestEmail("nonexistent-ws");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/nonexistent-workspace-slug/invitations/`,
      token,
      {
        emails: [{ email: inviteeEmail, role: ROLES.MEMBER }],
      }
    );

    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// List Invitations Tests
// ---------------------------------------------------------------------------
test.describe("List Invitations (GET /api/workspaces/:slug/invitations/)", () => {
  test("should list all workspace invitations", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    // Create some invitations first
    const email1 = generateTestEmail("list1");
    const email2 = generateTestEmail("list2");

    await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [
          { email: email1, role: ROLES.MEMBER },
          { email: email2, role: ROLES.ADMIN },
        ],
      }
    );

    // List invitations
    const res = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/invitations/`,
      token
    );

    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);

    // Verify our invitations are in the list
    const emails = data.map((inv: any) => inv.email);
    expect(emails).toContain(email1.toLowerCase());
    expect(emails).toContain(email2.toLowerCase());
  });

  test("should return correct response format for list", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    const res = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/invitations/`,
      token
    );

    expect(res.status()).toBe(200);
    const data = await res.json();

    if (data.length > 0) {
      const invitation = data[0];
      expect(invitation).toHaveProperty("id");
      expect(invitation).toHaveProperty("email");
      expect(invitation).toHaveProperty("role");
      expect(invitation).toHaveProperty("message");
      expect(invitation).toHaveProperty("accepted");
      expect(invitation).toHaveProperty("responded_at");
      expect(invitation).toHaveProperty("created_by_id");
      expect(invitation).toHaveProperty("created_at");
      expect(invitation).toHaveProperty("updated_at");
    }
  });

  test("should return 401 for unauthenticated list request", async ({
    wsSlug,
    request,
  }) => {
    const res = await request.get(
      `${API_BASE}/api/workspaces/${wsSlug}/invitations/`
    );

    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Delete/Revoke Invitation Tests
// ---------------------------------------------------------------------------
test.describe("Delete Invitation (DELETE /api/workspaces/:slug/invitations/:id/)", () => {
  test("should delete/revoke an invitation", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const inviteeEmail = generateTestEmail("delete-test");

    // Create invitation
    const createRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: inviteeEmail, role: ROLES.MEMBER }],
      }
    );
    const [invitation] = await createRes.json();
    const invitationId = invitation.id;

    // Delete invitation
    const deleteRes = await apiRequest(
      request,
      "DELETE",
      `/api/workspaces/${wsSlug}/invitations/${invitationId}/`,
      token
    );

    expect(deleteRes.status()).toBe(204);

    // Verify invitation is deleted
    const listRes = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/invitations/`,
      token
    );
    const invitations = await listRes.json();
    const found = invitations.find((inv: any) => inv.id === invitationId);
    expect(found).toBeUndefined();
  });

  test("should return 404 for non-existent invitation", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    const res = await apiRequest(
      request,
      "DELETE",
      `/api/workspaces/${wsSlug}/invitations/nonexistent-id/`,
      token
    );

    expect(res.status()).toBe(404);
  });

  test("should return 401 for unauthenticated delete request", async ({
    wsSlug,
    request,
  }) => {
    const res = await request.delete(
      `${API_BASE}/api/workspaces/${wsSlug}/invitations/some-id/`
    );

    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Get Invitation Details for Join Page Tests
// ---------------------------------------------------------------------------
test.describe("Get Invitation Details (GET /api/workspaces/:slug/invitations/:id/join/)", () => {
  test("should return invitation details with workspace info", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const inviteeEmail = generateTestEmail("join-details");

    // Create invitation
    const createRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: inviteeEmail, role: ROLES.MEMBER }],
        message: "Join our workspace!",
      }
    );
    const [invitation] = await createRes.json();

    // Get invitation details (this endpoint doesn't require workspace membership)
    const res = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/invitations/${invitation.id}/join/`,
      token
    );

    expect(res.status()).toBe(200);
    const data = await res.json();

    // Verify invitation data
    expect(data.id).toBe(invitation.id);
    expect(data.email).toBe(inviteeEmail.toLowerCase());
    expect(data.role).toBe(ROLES.MEMBER);
    expect(data.message).toBe("Join our workspace!");

    // Verify workspace data
    expect(data.workspace).toBeDefined();
    expect(data.workspace.slug).toBe(wsSlug);
    expect(data.workspace.name).toBe("Invitation Test WS");
  });

  test("should return 404 for non-existent invitation", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    const res = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/invitations/nonexistent-id/join/`,
      token
    );

    expect(res.status()).toBe(404);
  });

  test("should return 404 for wrong workspace slug", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const inviteeEmail = generateTestEmail("wrong-ws");

    // Create invitation
    const createRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: inviteeEmail, role: ROLES.MEMBER }],
      }
    );
    const [invitation] = await createRes.json();

    // Try to get with wrong workspace slug
    const res = await apiRequest(
      request,
      "GET",
      `/api/workspaces/wrong-slug/invitations/${invitation.id}/join/`,
      token
    );

    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Accept/Reject Invitation Tests
// ---------------------------------------------------------------------------
test.describe("Accept/Reject Invitation (POST /api/workspaces/:slug/invitations/:id/join/)", () => {
  test("should accept invitation and add user as member", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    // Create a new user who will accept the invitation
    const { email: inviteeEmail, sessionCookie: inviteeCookie } = await createUserAndGetSession("accept-test");
    // Normalize email to lowercase to match API behavior
    const normalizedEmail = inviteeEmail.toLowerCase();

    // Create invitation for the new user (use exact email from signup)
    const createRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: normalizedEmail, role: ROLES.MEMBER }],
      }
    );
    expect(createRes.status()).toBe(201);
    const invitations = await createRes.json();
    expect(invitations.length).toBe(1);
    const invitation = invitations[0];

    // Verify the invitation email is what we expect
    expect(invitation.email).toBe(normalizedEmail);

    // Accept invitation as the invitee (use directApiRequest to avoid cookie conflicts)
    const acceptRes = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/invitations/${invitation.id}/join/`,
      inviteeCookie,
      {
        email: invitation.email, // Use the exact email from the invitation
        accepted: true,
      }
    );

    expect(acceptRes.status()).toBe(200);
    const data = await acceptRes.json();
    expect(data.message).toContain("Accepted");

    // Verify user is now a workspace member
    const membersRes = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      token
    );
    const members = await membersRes.json();
    const newMember = members.find((m: any) => m.member.email === normalizedEmail);
    expect(newMember).toBeDefined();
    expect(newMember.role).toBe(ROLES.MEMBER);
  });

  test("should reject invitation", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    // Create a new user who will reject the invitation
    const { email: inviteeEmail, sessionCookie: inviteeCookie } = await createUserAndGetSession( "reject-test");
    // Normalize email to lowercase to match API behavior
    const normalizedEmail = inviteeEmail.toLowerCase();

    // Create invitation
    const createRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: normalizedEmail, role: ROLES.MEMBER }],
      }
    );
    expect(createRes.status()).toBe(201);
    const invitations = await createRes.json();
    expect(invitations.length).toBe(1);
    const invitation = invitations[0];

    // Reject invitation using exact email from invitation (use directApiRequest to avoid cookie conflicts)
    const rejectRes = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/invitations/${invitation.id}/join/`,
      inviteeCookie,
      {
        email: invitation.email, // Use the exact email from the invitation
        accepted: false,
      }
    );

    expect(rejectRes.status()).toBe(200);
    const data = await rejectRes.json();
    expect(data.message).toContain("not accepted");
  });

  test("should reject if email does not match invitation", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const inviteeEmail = generateTestEmail("mismatch");

    // Create invitation
    const createRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: inviteeEmail, role: ROLES.MEMBER }],
      }
    );
    const [invitation] = await createRes.json();

    // Try to accept with wrong email in body
    const acceptRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/${invitation.id}/join/`,
      token,
      {
        email: "wrong@test.local",
        accepted: true,
      }
    );

    expect(acceptRes.status()).toBe(403);
    const data = await acceptRes.json();
    expect(data.error).toContain("permission");
  });

  test("should reject double response to invitation", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    // Create a new user
    const { email: inviteeEmail, sessionCookie: inviteeCookie } = await createUserAndGetSession( "double-resp");
    // Normalize email to lowercase to match API behavior
    const normalizedEmail = inviteeEmail.toLowerCase();

    // Create invitation
    const createRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: normalizedEmail, role: ROLES.MEMBER }],
      }
    );
    expect(createRes.status()).toBe(201);
    const invitations = await createRes.json();
    expect(invitations.length).toBe(1);
    const invitation = invitations[0];

    // Reject first (to keep the invitation in DB for the second attempt)
    const firstRes = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/invitations/${invitation.id}/join/`,
      inviteeCookie,
      {
        email: invitation.email, // Use exact email from invitation
        accepted: false,
      }
    );
    expect(firstRes.status()).toBe(200);

    // Try to respond again
    const secondRes = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/invitations/${invitation.id}/join/`,
      inviteeCookie,
      {
        email: invitation.email, // Use exact email from invitation
        accepted: true,
      }
    );

    expect(secondRes.status()).toBe(400);
    const data = await secondRes.json();
    expect(data.error).toContain("already responded");
  });

  test("should return 404 for non-existent invitation", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/nonexistent-id/join/`,
      token,
      {
        email: "someone@test.local",
        accepted: true,
      }
    );

    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Update Invitation Tests
// ---------------------------------------------------------------------------
test.describe("Update Invitation (PATCH /api/workspaces/:slug/invitations/:id/)", () => {
  test("should update invitation role", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);
    const inviteeEmail = generateTestEmail("update-role");

    // Create invitation with member role
    const createRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: inviteeEmail, role: ROLES.MEMBER }],
      }
    );
    const [invitation] = await createRes.json();

    // Update to admin role
    const updateRes = await apiRequest(
      request,
      "PATCH",
      `/api/workspaces/${wsSlug}/invitations/${invitation.id}/`,
      token,
      {
        role: ROLES.ADMIN,
      }
    );

    expect(updateRes.status()).toBe(200);
    const data = await updateRes.json();
    expect(data.role).toBe(ROLES.ADMIN);
  });

  test("should reject update on already responded invitation", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    // Create a new user
    const { email: inviteeEmail, sessionCookie: inviteeCookie } = await createUserAndGetSession( "update-responded");
    // Normalize email to lowercase to match API behavior
    const normalizedEmail = inviteeEmail.toLowerCase();

    // Create invitation
    const createRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: normalizedEmail, role: ROLES.MEMBER }],
      }
    );
    expect(createRes.status()).toBe(201);
    const invitations = await createRes.json();
    expect(invitations.length).toBe(1);
    const invitation = invitations[0];

    // Reject the invitation using exact email from invitation
    const rejectRes = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/invitations/${invitation.id}/join/`,
      inviteeCookie,
      {
        email: invitation.email, // Use exact email from invitation
        accepted: false,
      }
    );
    expect(rejectRes.status()).toBe(200);

    // Try to update the responded invitation
    const updateRes = await apiRequest(
      request,
      "PATCH",
      `/api/workspaces/${wsSlug}/invitations/${invitation.id}/`,
      token,
      {
        role: ROLES.ADMIN,
      }
    );

    expect(updateRes.status()).toBe(400);
    const data = await updateRes.json();
    expect(data.detail).toContain("already been responded");
  });

  test("should return 404 for non-existent invitation", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    const res = await apiRequest(
      request,
      "PATCH",
      `/api/workspaces/${wsSlug}/invitations/nonexistent-id/`,
      token,
      {
        role: ROLES.ADMIN,
      }
    );

    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Permission Tests (Non-Admin Users)
// ---------------------------------------------------------------------------
test.describe("Invitation Permission Tests", () => {
  test("non-admin member cannot create invitations", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    // Create a regular member user
    const { email: memberEmail, sessionCookie: memberCookie } = await createUserAndGetSession( "regular-member");
    // Normalize email to lowercase to match API behavior
    const normalizedMemberEmail = memberEmail.toLowerCase();

    // Invite and accept as member
    const createInvRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: normalizedMemberEmail, role: ROLES.MEMBER }],
      }
    );
    expect(createInvRes.status()).toBe(201);
    const invitations = await createInvRes.json();
    expect(invitations.length).toBe(1);
    const memberInvitation = invitations[0];

    const acceptRes = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/invitations/${memberInvitation.id}/join/`,
      memberCookie,
      {
        email: memberInvitation.email, // Use exact email from invitation
        accepted: true,
      }
    );
    expect(acceptRes.status()).toBe(200);

    // Try to create invitation as non-admin member (use directApiRequest)
    const inviteeEmail = generateTestEmail("member-invite-attempt");
    const res = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      memberCookie,
      {
        emails: [{ email: inviteeEmail, role: ROLES.GUEST }],
      }
    );

    expect(res.status()).toBe(403);
  });

  test("non-admin member cannot list invitations", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(invPage);

    // Create a regular member user
    const { email: memberEmail, sessionCookie: memberCookie } = await createUserAndGetSession( "list-member");
    // Normalize email to lowercase to match API behavior
    const normalizedMemberEmail = memberEmail.toLowerCase();

    // Invite and accept as member
    const createInvRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      token,
      {
        emails: [{ email: normalizedMemberEmail, role: ROLES.MEMBER }],
      }
    );
    expect(createInvRes.status()).toBe(201);
    const invitations = await createInvRes.json();
    expect(invitations.length).toBe(1);
    const memberInvitation = invitations[0];

    const acceptRes = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/invitations/${memberInvitation.id}/join/`,
      memberCookie,
      {
        email: memberInvitation.email, // Use exact email from invitation
        accepted: true,
      }
    );
    expect(acceptRes.status()).toBe(200);

    // Try to list invitations as non-admin member (use directApiRequest)
    const res = await directApiRequest(
      "GET",
      `/api/workspaces/${wsSlug}/invitations/`,
      memberCookie
    );

    expect(res.status()).toBe(403);
  });

  test("non-member cannot access invitation endpoints", async ({
    invPage,
    wsSlug,
    request,
  }) => {
    // Create a user who is not a workspace member
    const { sessionCookie: outsiderCookie } = await createUserAndGetSession( "outsider");

    // Try to list invitations (use directApiRequest to avoid cookie conflicts)
    const listRes = await directApiRequest(
      "GET",
      `/api/workspaces/${wsSlug}/invitations/`,
      outsiderCookie
    );
    expect(listRes.status()).toBe(403);

    // Try to create invitation (use directApiRequest to avoid cookie conflicts)
    const createRes = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/invitations/`,
      outsiderCookie,
      {
        emails: [{ email: "someone@test.local", role: ROLES.MEMBER }],
      }
    );
    expect(createRes.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// UI Tests (via Browser)
// ---------------------------------------------------------------------------
test.describe("Invitation UI Tests", () => {
  test("should load workspace members/invitations settings page", async ({
    invPage,
    wsSlug,
  }) => {
    await invPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(invPage);

    // Should see the members page
    const fullNameHeader = invPage.getByText("Full name").first();
    await expect(fullNameHeader).toBeVisible({ timeout: 10_000 });
  });

  test("should show Add member button for admin", async ({
    invPage,
    wsSlug,
  }) => {
    await invPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(invPage);

    // Button text is "Add member"
    const addMemberBtn = invPage.locator('button:has-text("Add member")');
    await expect(addMemberBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should open invite modal when clicking Add member", async ({
    invPage,
    wsSlug,
  }) => {
    await invPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(invPage);

    // Click Add member button
    const addMemberBtn = invPage.locator('button:has-text("Add member")');
    await expect(addMemberBtn).toBeVisible({ timeout: 10_000 });
    await addMemberBtn.click();

    // Wait a bit for modal animation
    await invPage.waitForTimeout(500);

    // Wait for modal content to appear - look for "Invite" text or email-related input
    // The dialog might be present but need to check for visible inner content
    const inviteHeader = invPage.locator('text=/Invite|Add member|Email/i').first();
    await expect(inviteHeader).toBeVisible({ timeout: 10_000 });
  });
});
