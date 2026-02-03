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
  memberPage: Page;
  wsSlug: string;
};

// ── Test Data Interface ────────────────────────────────────────────────────
interface TestData {
  token: string;
  userId: string;
  email: string;
  workspaceId: string;
  wsSlug: string;
  membershipId: string;
}

// ── Helper: get test data from page ────────────────────────────────────────
function getTestData(page: Page): TestData {
  return (page as any).__testData;
}

// ── Main Fixture: authenticated admin user with workspace ──────────────────
const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("mem-ui"));
  },

  memberPage: async ({ page, request, wsSlug }, use) => {
    const email = generateTestEmail("mem-ui");
    const password = generateTestPassword();

    // 1. Create user via API
    const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "Member", last_name: "Admin" },
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
      data: { first_name: "Member", last_name: "Admin", is_onboarded: true },
    });

    // 4. Create workspace via API
    const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Members Test WS", slug: wsSlug, organization_size: "2-10" },
    });
    expect(wsRes.ok()).toBeTruthy();
    const workspace = await wsRes.json();

    // 5. Get user info
    const meRes = await request.get(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await meRes.json();

    // 6. Get the workspace membership for the admin
    const membersRes = await request.get(`${API_BASE}/api/workspaces/${wsSlug}/members/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const members = await membersRes.json();
    const adminMembership = members.find((m: any) => m.member.id === me.id);

    // Store test data in page for tests to use
    (page as any).__testData = {
      token,
      userId: me.id,
      email,
      workspaceId: workspace.id,
      wsSlug,
      membershipId: adminMembership?.id || "",
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
// Helper: Create a new user, onboard them, and get their session cookie
// Uses fetch directly to avoid polluting the shared request context
// Returns the session cookie for use with directApiRequest
// ---------------------------------------------------------------------------
async function createUserAndGetSession(
  emailPrefix: string
): Promise<{ email: string; sessionCookie: string; userId: string }> {
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

  // Onboard the user using session cookie
  await fetch(`${API_BASE}/api/users/me/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Cookie": sessionCookie
    },
    body: JSON.stringify({ first_name: "Test", last_name: "User", is_onboarded: true }),
  });

  // Get user ID using session cookie
  const meRes = await fetch(`${API_BASE}/api/users/me/`, {
    headers: { "Cookie": sessionCookie },
  });
  const me = await meRes.json();

  return { email, sessionCookie, userId: me.id };
}

// ===========================================================================
// LIST WORKSPACE MEMBERS (GET /api/workspaces/:slug/members/)
// ===========================================================================
test.describe("List Workspace Members (GET /api/workspaces/:slug/members/)", () => {
  test("should list all active workspace members", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token, userId } = getTestData(memberPage);

    const res = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      token
    );

    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);

    // Verify the admin user is in the list
    const adminMember = data.find((m: any) => m.member.id === userId);
    expect(adminMember).toBeDefined();
    expect(adminMember.role).toBe(ROLES.ADMIN);
  });

  test("should return correct member response format", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const res = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      token
    );

    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);

    const member = data[0];
    // Verify member structure
    expect(member).toHaveProperty("id");
    expect(member).toHaveProperty("member");
    expect(member).toHaveProperty("role");
    expect(member).toHaveProperty("is_active");
    expect(member).toHaveProperty("created_at");
    expect(member).toHaveProperty("updated_at");

    // Verify nested member object
    expect(member.member).toHaveProperty("id");
    expect(member.member).toHaveProperty("email");
    expect(member.member).toHaveProperty("first_name");
    expect(member.member).toHaveProperty("last_name");
    expect(member.member).toHaveProperty("display_name");
    expect(member.member).toHaveProperty("avatar");
  });

  test("should return 401 for unauthenticated request", async ({
    wsSlug,
    request,
  }) => {
    const res = await request.get(
      `${API_BASE}/api/workspaces/${wsSlug}/members/`
    );

    expect(res.status()).toBe(401);
  });

  test("should return 404 for non-existent workspace", async ({
    memberPage,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const res = await apiRequest(
      request,
      "GET",
      `/api/workspaces/nonexistent-workspace-slug/members/`,
      token
    );

    expect(res.status()).toBe(404);
  });

  test("should return 403 for non-member user", async ({
    memberPage,
    wsSlug,
  }) => {
    // Create a user who is not a workspace member
    const { sessionCookie: outsiderCookie } = await createUserAndGetSession("outsider-list");

    const res = await directApiRequest(
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      outsiderCookie
    );

    expect(res.status()).toBe(403);
  });
});

// ===========================================================================
// GET CURRENT USER'S MEMBERSHIP (GET /api/workspaces/:slug/members/me/)
// ===========================================================================
test.describe("Get Current User's Membership (GET /api/workspaces/:slug/members/me/)", () => {
  test("should get current user's membership info", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token, membershipId, userId } = getTestData(memberPage);

    const res = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/members/me/`,
      token
    );

    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(membershipId);
    expect(data.member.id).toBe(userId);
    expect(data.role).toBe(ROLES.ADMIN);
    expect(data.is_active).toBe(true);
  });

  test("should return 401 for unauthenticated request", async ({
    wsSlug,
    request,
  }) => {
    const res = await request.get(
      `${API_BASE}/api/workspaces/${wsSlug}/members/me/`
    );

    expect(res.status()).toBe(401);
  });

  test("should return 403 for non-member user", async ({
    memberPage,
    wsSlug,
  }) => {
    const { sessionCookie: outsiderCookie } = await createUserAndGetSession("outsider-me");

    const res = await directApiRequest(
      "GET",
      `/api/workspaces/${wsSlug}/members/me/`,
      outsiderCookie
    );

    expect(res.status()).toBe(403);
  });
});

// ===========================================================================
// GET WORKSPACE MEMBER ME (GET /api/workspaces/:slug/workspace-members/me/)
// ===========================================================================
test.describe("Get Workspace Member Me (GET /api/workspaces/:slug/workspace-members/me/)", () => {
  test("should return IWorkspaceMemberMe format", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token, membershipId, userId, workspaceId } = getTestData(memberPage);

    const res = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/workspace-members/me/`,
      token
    );

    expect(res.status()).toBe(200);
    const data = await res.json();

    // Verify IWorkspaceMemberMe format
    expect(data.id).toBe(membershipId);
    expect(data.member).toBe(userId);
    expect(data.workspace).toBe(workspaceId);
    expect(data.role).toBe(ROLES.ADMIN);
    expect(data).toHaveProperty("draft_issue_count");
    expect(data).toHaveProperty("view_props");
    expect(data).toHaveProperty("default_props");
    expect(data).toHaveProperty("issue_props");
  });

  test("should return 401 for unauthenticated request", async ({
    wsSlug,
    request,
  }) => {
    const res = await request.get(
      `${API_BASE}/api/workspaces/${wsSlug}/workspace-members/me/`
    );

    expect(res.status()).toBe(401);
  });
});

// ===========================================================================
// ADD MEMBERS (POST /api/workspaces/:slug/members/)
// ===========================================================================
test.describe("Add Members (POST /api/workspaces/:slug/members/)", () => {
  test("should add a single member with member role", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    // Create a new user to add
    const { userId: newUserId } = await createUserAndGetSession("add-member");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: newUserId, role: ROLES.MEMBER }],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].member.id).toBe(newUserId);
    expect(data[0].role).toBe(ROLES.MEMBER);
  });

  test("should add multiple members at once", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const { userId: userId1 } = await createUserAndGetSession("add-multi-1");
    const { userId: userId2 } = await createUserAndGetSession("add-multi-2");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [
          { member_id: userId1, role: ROLES.MEMBER },
          { member_id: userId2, role: ROLES.GUEST },
        ],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(2);
  });

  test("should reject invalid role value", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const { userId: newUserId } = await createUserAndGetSession("invalid-role");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: newUserId, role: 99 }],
      }
    );

    expect(res.status()).toBe(400);
  });

  test("should reject empty members array", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [],
      }
    );

    expect(res.status()).toBe(400);
  });

  test("should return 403 for non-admin user", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    // Create and add a regular member
    const { userId: memberId, sessionCookie: memberCookie } = await createUserAndGetSession("regular-member-add");

    await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: memberId, role: ROLES.MEMBER }],
      }
    );

    // Try to add another user as the regular member
    const { userId: anotherUserId } = await createUserAndGetSession("another-user");

    const res = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      memberCookie,
      {
        members: [{ member_id: anotherUserId, role: ROLES.GUEST }],
      }
    );

    expect(res.status()).toBe(403);
  });

  test("should skip adding existing members silently", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token, userId } = getTestData(memberPage);

    // Try to add the admin user again
    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: userId, role: ROLES.MEMBER }],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    // Should return empty array since user already exists
    expect(data.length).toBe(0);
  });
});

// ===========================================================================
// UPDATE MEMBER ROLE (PATCH /api/workspaces/:slug/members/:memberId/)
// ===========================================================================
test.describe("Update Member Role (PATCH /api/workspaces/:slug/members/:memberId/)", () => {
  test("should update member role from member to admin", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    // Create and add a member
    const { userId: memberId } = await createUserAndGetSession("update-role");

    const addRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: memberId, role: ROLES.MEMBER }],
      }
    );
    expect(addRes.status()).toBe(201);
    const addedMembers = await addRes.json();
    expect(addedMembers.length).toBe(1);
    const addedMember = addedMembers[0];

    // Update role to admin
    const res = await apiRequest(
      request,
      "PATCH",
      `/api/workspaces/${wsSlug}/members/${addedMember.id}/`,
      token,
      {
        role: ROLES.ADMIN,
      }
    );

    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.role).toBe(ROLES.ADMIN);
  });

  test("should update member role to guest", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const { userId: memberId } = await createUserAndGetSession("update-to-guest");

    const addRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: memberId, role: ROLES.MEMBER }],
      }
    );
    expect(addRes.status()).toBe(201);
    const addedMembers = await addRes.json();
    expect(addedMembers.length).toBe(1);
    const addedMember = addedMembers[0];

    const res = await apiRequest(
      request,
      "PATCH",
      `/api/workspaces/${wsSlug}/members/${addedMember.id}/`,
      token,
      {
        role: ROLES.GUEST,
      }
    );

    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.role).toBe(ROLES.GUEST);
  });

  test("should reject updating own role", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token, membershipId } = getTestData(memberPage);

    const res = await apiRequest(
      request,
      "PATCH",
      `/api/workspaces/${wsSlug}/members/${membershipId}/`,
      token,
      {
        role: ROLES.MEMBER,
      }
    );

    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("cannot update your own role");
  });

  test("should return 404 for non-existent member", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const res = await apiRequest(
      request,
      "PATCH",
      `/api/workspaces/${wsSlug}/members/nonexistent-member-id/`,
      token,
      {
        role: ROLES.MEMBER,
      }
    );

    expect(res.status()).toBe(404);
  });

  test("should return 403 for non-admin user", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    // Create and add two regular members
    const { userId: member1Id, sessionCookie: member1Cookie } = await createUserAndGetSession("member1-update");
    const { userId: member2Id } = await createUserAndGetSession("member2-update");

    await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [
          { member_id: member1Id, role: ROLES.MEMBER },
          { member_id: member2Id, role: ROLES.MEMBER },
        ],
      }
    );

    // Get member2's membership ID
    const membersRes = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      token
    );
    const members = await membersRes.json();
    const member2Membership = members.find((m: any) => m.member.id === member2Id);

    // Try to update member2's role as member1 (non-admin)
    const res = await directApiRequest(
      "PATCH",
      `/api/workspaces/${wsSlug}/members/${member2Membership.id}/`,
      member1Cookie,
      {
        role: ROLES.GUEST,
      }
    );

    expect(res.status()).toBe(403);
  });

  test("should reject invalid role value", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const { userId: memberId } = await createUserAndGetSession("invalid-update-role");

    const addRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: memberId, role: ROLES.MEMBER }],
      }
    );
    expect(addRes.status()).toBe(201);
    const addedMembers = await addRes.json();
    expect(addedMembers.length).toBe(1);
    const addedMember = addedMembers[0];

    const res = await apiRequest(
      request,
      "PATCH",
      `/api/workspaces/${wsSlug}/members/${addedMember.id}/`,
      token,
      {
        role: 99,
      }
    );

    expect(res.status()).toBe(400);
  });
});

// ===========================================================================
// REMOVE MEMBER (DELETE /api/workspaces/:slug/members/:memberId/)
// ===========================================================================
test.describe("Remove Member (DELETE /api/workspaces/:slug/members/:memberId/)", () => {
  test("should remove a workspace member", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    // Create and add a member
    const { userId: memberId } = await createUserAndGetSession("remove-member");

    const addRes = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: memberId, role: ROLES.MEMBER }],
      }
    );
    expect(addRes.status()).toBe(201);
    const addedMembers = await addRes.json();
    expect(addedMembers.length).toBe(1);
    const addedMember = addedMembers[0];

    // Remove the member
    const res = await apiRequest(
      request,
      "DELETE",
      `/api/workspaces/${wsSlug}/members/${addedMember.id}/`,
      token
    );

    expect(res.status()).toBe(204);

    // Verify member is removed
    const membersRes = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      token
    );
    const members = await membersRes.json();
    const removedMember = members.find((m: any) => m.member.id === memberId);
    expect(removedMember).toBeUndefined();
  });

  test("should reject removing yourself", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token, membershipId } = getTestData(memberPage);

    const res = await apiRequest(
      request,
      "DELETE",
      `/api/workspaces/${wsSlug}/members/${membershipId}/`,
      token
    );

    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("cannot remove yourself");
  });

  test("should return 404 for non-existent member", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const res = await apiRequest(
      request,
      "DELETE",
      `/api/workspaces/${wsSlug}/members/nonexistent-member-id/`,
      token
    );

    expect(res.status()).toBe(404);
  });

  test("should return 403 for non-admin user", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    // Create and add two regular members
    const { userId: member1Id, sessionCookie: member1Cookie } = await createUserAndGetSession("member1-remove");
    const { userId: member2Id } = await createUserAndGetSession("member2-remove");

    await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [
          { member_id: member1Id, role: ROLES.MEMBER },
          { member_id: member2Id, role: ROLES.MEMBER },
        ],
      }
    );

    // Get member2's membership ID
    const membersRes = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      token
    );
    const members = await membersRes.json();
    const member2Membership = members.find((m: any) => m.member.id === member2Id);

    // Try to remove member2 as member1 (non-admin)
    const res = await directApiRequest(
      "DELETE",
      `/api/workspaces/${wsSlug}/members/${member2Membership.id}/`,
      member1Cookie
    );

    expect(res.status()).toBe(403);
  });

  test("should reject removing member with higher role", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token, membershipId } = getTestData(memberPage);

    // Create a second admin and then downgrade them to member
    const { userId: admin2Id, sessionCookie: admin2Cookie } = await createUserAndGetSession("admin2-remove");

    await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: admin2Id, role: ROLES.MEMBER }],
      }
    );

    // Now try to have admin2 (a member) remove the original admin
    const res = await directApiRequest(
      "DELETE",
      `/api/workspaces/${wsSlug}/members/${membershipId}/`,
      admin2Cookie
    );

    expect(res.status()).toBe(403);
  });
});

// ===========================================================================
// LEAVE WORKSPACE (POST /api/workspaces/:slug/members/leave/)
// ===========================================================================
test.describe("Leave Workspace (POST /api/workspaces/:slug/members/leave/)", () => {
  test("should allow member to leave workspace", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    // Create and add a regular member
    const { userId: memberId, sessionCookie: memberCookie } = await createUserAndGetSession("leave-member");

    await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: memberId, role: ROLES.MEMBER }],
      }
    );

    // Member leaves the workspace
    const res = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/members/leave/`,
      memberCookie
    );

    expect(res.status()).toBe(204);

    // Verify member is no longer in the workspace
    const membersRes = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      token
    );
    const members = await membersRes.json();
    const leftMember = members.find((m: any) => m.member.id === memberId);
    expect(leftMember).toBeUndefined();
  });

  test("should prevent sole admin from leaving", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token, userId } = getTestData(memberPage);

    // First, get all current members
    const membersRes = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      token
    );
    const members = await membersRes.json();
    const currentUser = members.find((m: any) => m.member.id === userId);

    // Verify we're actually an admin
    expect(currentUser).toBeDefined();
    expect(currentUser.role).toBe(ROLES.ADMIN);

    // Make sure we're the sole admin by demoting any other admins
    const otherAdmins = members.filter((m: any) => m.role === ROLES.ADMIN && m.member.id !== userId);
    for (const admin of otherAdmins) {
      // Demote to member
      await apiRequest(
        request,
        "PATCH",
        `/api/workspaces/${wsSlug}/members/${admin.id}/`,
        token,
        { role: ROLES.MEMBER }
      );
    }

    // Verify we're now the sole admin
    const updatedMembersRes = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      token
    );
    const updatedMembers = await updatedMembersRes.json();
    const admins = updatedMembers.filter((m: any) => m.role === ROLES.ADMIN);
    expect(admins.length).toBe(1);
    expect(admins[0].member.id).toBe(userId);

    // Try to leave as the sole admin
    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/leave/`,
      token
    );

    expect(res.status()).toBe(400);
    const data = await res.json();
    // Check for "sole admin" or similar message
    expect(data.error.toLowerCase()).toMatch(/sole|only|last.*admin/i);
  });

  test("should allow admin to leave if another admin exists", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token, userId } = getTestData(memberPage);

    // Create and add another admin
    const { userId: admin2Id, sessionCookie: admin2Cookie } = await createUserAndGetSession("admin2-leave");

    await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: admin2Id, role: ROLES.ADMIN }],
      }
    );

    // Original admin leaves
    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/leave/`,
      token
    );

    expect(res.status()).toBe(204);

    // Verify admin is no longer in workspace (using admin2's cookie)
    const membersRes = await directApiRequest(
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      admin2Cookie
    );
    const members = await membersRes.json();
    const leftAdmin = members.find((m: any) => m.member.id === userId);
    expect(leftAdmin).toBeUndefined();
  });

  test("should return 401 for unauthenticated request", async ({
    wsSlug,
    request,
  }) => {
    const res = await request.post(
      `${API_BASE}/api/workspaces/${wsSlug}/members/leave/`
    );

    expect(res.status()).toBe(401);
  });
});

// ===========================================================================
// MEMBER ROLES TESTS
// ===========================================================================
test.describe("Member Roles", () => {
  test("should correctly assign guest role (5)", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const { userId: guestId } = await createUserAndGetSession("guest-role");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: guestId, role: ROLES.GUEST }],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].role).toBe(ROLES.GUEST);
  });

  test("should correctly assign viewer role (10)", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const { userId: viewerId } = await createUserAndGetSession("viewer-role");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: viewerId, role: ROLES.VIEWER }],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].role).toBe(ROLES.VIEWER);
  });

  test("should correctly assign member role (15)", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const { userId: memberId } = await createUserAndGetSession("member-role");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: memberId, role: ROLES.MEMBER }],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].role).toBe(ROLES.MEMBER);
  });

  test("should correctly assign admin role (20)", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    const { userId: adminId } = await createUserAndGetSession("admin-role");

    const res = await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: adminId, role: ROLES.ADMIN }],
      }
    );

    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].role).toBe(ROLES.ADMIN);
  });
});

// ===========================================================================
// PERMISSION CHECKS
// ===========================================================================
test.describe("Permission Checks", () => {
  test("guest cannot update member roles", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    // Add a guest and another member
    const { userId: guestId, sessionCookie: guestCookie } = await createUserAndGetSession("guest-perm");
    const { userId: otherId } = await createUserAndGetSession("other-perm");

    await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [
          { member_id: guestId, role: ROLES.GUEST },
          { member_id: otherId, role: ROLES.MEMBER },
        ],
      }
    );

    // Get the other member's membership ID
    const membersRes = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      token
    );
    const members = await membersRes.json();
    const otherMembership = members.find((m: any) => m.member.id === otherId);

    // Guest tries to update role
    const res = await directApiRequest(
      "PATCH",
      `/api/workspaces/${wsSlug}/members/${otherMembership.id}/`,
      guestCookie,
      {
        role: ROLES.GUEST,
      }
    );

    expect(res.status()).toBe(403);
  });

  test("viewer cannot remove members", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    // Add a viewer and another member
    const { userId: viewerId, sessionCookie: viewerCookie } = await createUserAndGetSession("viewer-perm");
    const { userId: otherId } = await createUserAndGetSession("other-viewer-perm");

    await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [
          { member_id: viewerId, role: ROLES.VIEWER },
          { member_id: otherId, role: ROLES.MEMBER },
        ],
      }
    );

    // Get the other member's membership ID
    const membersRes = await apiRequest(
      request,
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      token
    );
    const members = await membersRes.json();
    const otherMembership = members.find((m: any) => m.member.id === otherId);

    // Viewer tries to remove member
    const res = await directApiRequest(
      "DELETE",
      `/api/workspaces/${wsSlug}/members/${otherMembership.id}/`,
      viewerCookie
    );

    expect(res.status()).toBe(403);
  });

  test("member cannot add new members", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    // Add a regular member
    const { userId: memberId, sessionCookie: memberCookie } = await createUserAndGetSession("member-add-perm");

    await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: memberId, role: ROLES.MEMBER }],
      }
    );

    // Member tries to add a new user
    const { userId: newUserId } = await createUserAndGetSession("new-user-perm");

    const res = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      memberCookie,
      {
        members: [{ member_id: newUserId, role: ROLES.GUEST }],
      }
    );

    expect(res.status()).toBe(403);
  });

  test("admin can perform all member operations", async ({
    memberPage,
    wsSlug,
    request,
  }) => {
    const { token } = getTestData(memberPage);

    // Add a second admin
    const { userId: admin2Id, sessionCookie: admin2Cookie } = await createUserAndGetSession("admin2-perm");

    await apiRequest(
      request,
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      token,
      {
        members: [{ member_id: admin2Id, role: ROLES.ADMIN }],
      }
    );

    // Admin2 can list members
    const listRes = await directApiRequest(
      "GET",
      `/api/workspaces/${wsSlug}/members/`,
      admin2Cookie
    );
    expect(listRes.status()).toBe(200);

    // Admin2 can add new members
    const { userId: newUserId } = await createUserAndGetSession("admin-add-perm");
    const addRes = await directApiRequest(
      "POST",
      `/api/workspaces/${wsSlug}/members/`,
      admin2Cookie,
      {
        members: [{ member_id: newUserId, role: ROLES.MEMBER }],
      }
    );
    expect(addRes.status()).toBe(201);
    const addedMembers = await addRes.json();
    expect(addedMembers.length).toBe(1);
    const addedMember = addedMembers[0];

    // Admin2 can update member roles
    const updateRes = await directApiRequest(
      "PATCH",
      `/api/workspaces/${wsSlug}/members/${addedMember.id}/`,
      admin2Cookie,
      {
        role: ROLES.GUEST,
      }
    );
    expect(updateRes.status()).toBe(200);

    // Admin2 can remove members
    const removeRes = await directApiRequest(
      "DELETE",
      `/api/workspaces/${wsSlug}/members/${addedMember.id}/`,
      admin2Cookie
    );
    expect(removeRes.status()).toBe(204);
  });
});

// ===========================================================================
// UI TESTS
// ===========================================================================
test.describe("Workspace Members UI", () => {
  test("should load members settings page", async ({
    memberPage,
    wsSlug,
  }) => {
    await memberPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(memberPage);

    // Should see the members table
    const fullNameHeader = memberPage.getByText("Full name").first();
    await expect(fullNameHeader).toBeVisible({ timeout: 10_000 });
  });

  test("should show current user in members list", async ({
    memberPage,
    wsSlug,
  }) => {
    await memberPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(memberPage);

    // Should see the admin user
    const memberRow = memberPage.locator('text="Member Admin"').first();
    await expect(memberRow).toBeVisible({ timeout: 10_000 });
  });

  test("should show Admin role for workspace creator", async ({
    memberPage,
    wsSlug,
  }) => {
    await memberPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(memberPage);

    // Should see Admin role
    const adminRole = memberPage.locator('text="Admin"').first();
    await expect(adminRole).toBeVisible({ timeout: 10_000 });
  });

  test("should show Add member button for admin", async ({
    memberPage,
    wsSlug,
  }) => {
    await memberPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(memberPage);

    const addMemberBtn = memberPage.locator('button:has-text("Add member")');
    await expect(addMemberBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should show search input", async ({
    memberPage,
    wsSlug,
  }) => {
    await memberPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(memberPage);

    const searchInput = memberPage.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
  });

  test("should filter members via search", async ({
    memberPage,
    wsSlug,
  }) => {
    await memberPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(memberPage);

    const searchInput = memberPage.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Search for the admin user
    await searchInput.fill("Member Admin");
    await memberPage.waitForTimeout(500);

    // Should still see the member
    const memberRow = memberPage.locator('text="Member Admin"').first();
    await expect(memberRow).toBeVisible({ timeout: 5_000 });

    // Search for non-existent user
    await searchInput.clear();
    await searchInput.fill("zzz-nonexistent-zzz");
    await memberPage.waitForTimeout(500);

    // Member should not be visible
    const memberGone = await memberPage
      .locator('text="Member Admin"')
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    expect(memberGone).toBeFalsy();
  });

  test("should show Filters dropdown", async ({
    memberPage,
    wsSlug,
  }) => {
    await memberPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(memberPage);

    const filtersBtn = memberPage.locator('button:has-text("Filters")').first();
    await expect(filtersBtn).toBeVisible({ timeout: 10_000 });
  });
});
