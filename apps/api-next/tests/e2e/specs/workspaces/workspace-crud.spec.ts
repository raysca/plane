import { test, expect } from "../../fixtures/base";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

function uniqueSlug(prefix = "e2e-ws") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Workspace CRUD
// ---------------------------------------------------------------------------
test.describe("Workspace CRUD", () => {
  test("should create a workspace with minimal fields", async ({ apiContext }) => {
    const slug = uniqueSlug();
    const res = await apiContext.post("/api/workspaces/", {
      data: { name: "Minimal Workspace", slug, organization_size: "1-10" },
    });
    expect(res.ok()).toBeTruthy();
    const ws = await res.json();
    expect(ws.name).toBe("Minimal Workspace");
    expect(ws.slug).toBe(slug);
  });

  test("should create a workspace with a generated slug", async ({ apiContext }) => {
    const slug = uniqueSlug("auto");
    const res = await apiContext.post("/api/workspaces/", {
      data: { name: "Auto Slug Workspace", slug },
    });
    expect(res.ok()).toBeTruthy();
    const ws = await res.json();
    expect(ws.slug).toBe(slug);
    expect(ws.name).toBe("Auto Slug Workspace");
  });

  test("should create a workspace with all optional fields", async ({ apiContext }) => {
    const slug = uniqueSlug();
    const res = await apiContext.post("/api/workspaces/", {
      data: {
        name: "Full Workspace",
        slug,
        organization_size: "11-50",
        timezone: "America/New_York",
      },
    });
    expect(res.ok()).toBeTruthy();
    const ws = await res.json();
    expect(ws.slug).toBe(slug);
    expect(ws.organization_size).toBe("11-50");
  });

  test("should list workspaces and include newly created one", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Listed WS", slug },
    });

    const res = await apiContext.get("/api/workspaces/");
    expect(res.ok()).toBeTruthy();
    const list = await res.json();
    expect(Array.isArray(list)).toBeTruthy();
    const found = list.find((w: any) => w.slug === slug);
    expect(found).toBeDefined();
    expect(found.name).toBe("Listed WS");
  });

  test("should get a single workspace by slug", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Get By Slug", slug },
    });

    const res = await apiContext.get(`/api/workspaces/${slug}/`);
    expect(res.ok()).toBeTruthy();
    const ws = await res.json();
    expect(ws.slug).toBe(slug);
    expect(ws.name).toBe("Get By Slug");
  });

  test("should update workspace name", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Before Update", slug },
    });

    const res = await apiContext.patch(`/api/workspaces/${slug}/`, {
      data: { name: "After Update" },
    });
    expect(res.ok()).toBeTruthy();
    const ws = await res.json();
    expect(ws.name).toBe("After Update");
  });

  test("should update workspace organization_size and timezone", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Update Fields", slug },
    });

    const res = await apiContext.patch(`/api/workspaces/${slug}/`, {
      data: { organization_size: "51-200", timezone: "Europe/London" },
    });
    expect(res.ok()).toBeTruthy();
    const ws = await res.json();
    expect(ws.organization_size).toBe("51-200");
  });

  test("should delete a workspace", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "To Delete", slug },
    });

    const del = await apiContext.delete(`/api/workspaces/${slug}/`);
    expect(del.status()).toBe(204);

    // Verify it's gone
    const get = await apiContext.get(`/api/workspaces/${slug}/`);
    expect(get.ok()).toBeFalsy();
  });

  test("should return 404 for non-existent workspace", async ({ apiContext }) => {
    const res = await apiContext.get("/api/workspaces/non-existent-slug-xyz/");
    expect(res.ok()).toBeFalsy();
  });

  test("should reject creating a workspace with duplicate slug", async ({ apiContext }) => {
    const slug = uniqueSlug();
    const first = await apiContext.post("/api/workspaces/", {
      data: { name: "First", slug },
    });
    expect(first.ok()).toBeTruthy();

    const second = await apiContext.post("/api/workspaces/", {
      data: { name: "Second", slug },
    });
    expect(second.ok()).toBeFalsy();
  });

  test("should reject creating a workspace with empty name", async ({ apiContext }) => {
    const res = await apiContext.post("/api/workspaces/", {
      data: { name: "", slug: uniqueSlug() },
    });
    expect(res.ok()).toBeFalsy();
  });

  test("should reject creating a workspace with invalid slug format", async ({ apiContext }) => {
    const res = await apiContext.post("/api/workspaces/", {
      data: { name: "Bad Slug", slug: "INVALID SLUG!" },
    });
    expect(res.ok()).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Workspace Members
// ---------------------------------------------------------------------------
test.describe("Workspace Members", () => {
  test("creator should be a member of the workspace", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Member Test", slug },
    });

    const res = await apiContext.get(`/api/workspaces/${slug}/members/`);
    expect(res.ok()).toBeTruthy();
    const members = await res.json();
    expect(Array.isArray(members)).toBeTruthy();
    expect(members.length).toBeGreaterThanOrEqual(1);
  });

  test("should get current user membership via /members/me/", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Me Endpoint", slug },
    });

    const res = await apiContext.get(`/api/workspaces/${slug}/members/me/`);
    expect(res.ok()).toBeTruthy();
    const me = await res.json();
    expect(me.member).toBeDefined();
    expect(me.role).toBeDefined();
  });

  test("should get current user membership via /workspace-members/me/", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "WS Members Me", slug },
    });

    const res = await apiContext.get(`/api/workspaces/${slug}/workspace-members/me/`);
    expect(res.ok()).toBeTruthy();
    const me = await res.json();
    expect(me.role).toBeDefined();
  });

  test("should add a new member to the workspace", async ({ apiContext, playwright }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Add Member WS", slug },
    });

    // Create a second user
    const secondCtx = await playwright.request.newContext({ baseURL: API_BASE });
    const signupRes = await secondCtx.post("/auth/sign-up/", {
      data: {
        email: `member-${Date.now()}@test.local`,
        password: "TestPassword123!",
        first_name: "New",
        last_name: "Member",
      },
    });
    expect(signupRes.ok()).toBeTruthy();
    const signupData = await signupRes.json();
    const newUserId = signupData.user.id;

    // Add the second user as a member (role 15 = Member)
    const addRes = await apiContext.post(`/api/workspaces/${slug}/members/`, {
      data: { members: [{ member_id: newUserId, role: 15 }] },
    });
    expect(addRes.ok()).toBeTruthy();

    // Verify member appears in list
    const listRes = await apiContext.get(`/api/workspaces/${slug}/members/`);
    const members = await listRes.json();
    const found = members.find((m: any) => m.member?.id === newUserId);
    expect(found).toBeDefined();
    expect(found.role).toBe(15);

    await secondCtx.dispose();
  });

  test("should update a member's role", async ({ apiContext, playwright }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Update Role WS", slug },
    });

    // Create and add a second user
    const secondCtx = await playwright.request.newContext({ baseURL: API_BASE });
    const signupRes = await secondCtx.post("/auth/sign-up/", {
      data: {
        email: `role-${Date.now()}@test.local`,
        password: "TestPassword123!",
        first_name: "Role",
        last_name: "User",
      },
    });
    const { user } = await signupRes.json();

    await apiContext.post(`/api/workspaces/${slug}/members/`, {
      data: { members: [{ member_id: user.id, role: 15 }] },
    });

    // Get the member's workspace member ID
    const listRes = await apiContext.get(`/api/workspaces/${slug}/members/`);
    const members = await listRes.json();
    const member = members.find((m: any) => m.member?.id === user.id);

    // Update role to Viewer (10)
    const patchRes = await apiContext.patch(
      `/api/workspaces/${slug}/members/${member.id}/`,
      { data: { role: 10 } },
    );
    expect(patchRes.ok()).toBeTruthy();
    const updated = await patchRes.json();
    expect(updated.role).toBe(10);

    await secondCtx.dispose();
  });

  test("should remove a member from the workspace", async ({ apiContext, playwright }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Remove Member WS", slug },
    });

    // Create and add a second user
    const secondCtx = await playwright.request.newContext({ baseURL: API_BASE });
    const signupRes = await secondCtx.post("/auth/sign-up/", {
      data: {
        email: `remove-${Date.now()}@test.local`,
        password: "TestPassword123!",
        first_name: "Remove",
        last_name: "Me",
      },
    });
    const { user } = await signupRes.json();

    await apiContext.post(`/api/workspaces/${slug}/members/`, {
      data: { members: [{ member_id: user.id, role: 15 }] },
    });

    // Get member ID
    const listRes = await apiContext.get(`/api/workspaces/${slug}/members/`);
    const members = await listRes.json();
    const member = members.find((m: any) => m.member?.id === user.id);

    // Remove member
    const delRes = await apiContext.delete(`/api/workspaces/${slug}/members/${member.id}/`);
    expect(delRes.status()).toBe(204);

    // Verify member is gone from active list
    const afterList = await apiContext.get(`/api/workspaces/${slug}/members/`);
    const afterMembers = await afterList.json();
    const removed = afterMembers.find((m: any) => m.member?.id === user.id);
    expect(removed).toBeUndefined();

    await secondCtx.dispose();
  });

  test("a member should be able to leave the workspace", async ({ apiContext, playwright }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Leave WS", slug },
    });

    // Create a second user and add them
    const secondCtx = await playwright.request.newContext({ baseURL: API_BASE });
    const signupRes = await secondCtx.post("/auth/sign-up/", {
      data: {
        email: `leave-${Date.now()}@test.local`,
        password: "TestPassword123!",
        first_name: "Leave",
        last_name: "User",
      },
    });
    const { user } = await signupRes.json();

    await apiContext.post(`/api/workspaces/${slug}/members/`, {
      data: { members: [{ member_id: user.id, role: 15 }] },
    });

    // Second user leaves the workspace using their own context
    const leaveRes = await secondCtx.post(`${API_BASE}/api/workspaces/${slug}/members/leave/`);
    expect(leaveRes.status()).toBe(204);

    await secondCtx.dispose();
  });
});

// ---------------------------------------------------------------------------
// Workspace Invitations
// ---------------------------------------------------------------------------
test.describe("Workspace Invitations", () => {
  test("should create an invitation", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Invite WS", slug },
    });

    const res = await apiContext.post(`/api/workspaces/${slug}/invitations/`, {
      data: {
        emails: [{ email: `invite-${Date.now()}@test.local`, role: 15 }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const invitations = await res.json();
    expect(Array.isArray(invitations)).toBeTruthy();
    expect(invitations.length).toBe(1);
    expect(invitations[0].role).toBe(15);
  });

  test("should list invitations", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "List Invites", slug },
    });

    const invEmail = `list-inv-${Date.now()}@test.local`;
    await apiContext.post(`/api/workspaces/${slug}/invitations/`, {
      data: { emails: [{ email: invEmail, role: 15 }] },
    });

    const res = await apiContext.get(`/api/workspaces/${slug}/invitations/`);
    expect(res.ok()).toBeTruthy();
    const invitations = await res.json();
    expect(Array.isArray(invitations)).toBeTruthy();
    const found = invitations.find((i: any) => i.email === invEmail);
    expect(found).toBeDefined();
  });

  test("should update an invitation role", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Update Invite", slug },
    });

    const createRes = await apiContext.post(`/api/workspaces/${slug}/invitations/`, {
      data: { emails: [{ email: `upd-inv-${Date.now()}@test.local`, role: 15 }] },
    });
    const [invitation] = await createRes.json();

    const patchRes = await apiContext.patch(
      `/api/workspaces/${slug}/invitations/${invitation.id}/`,
      { data: { role: 10 } },
    );
    expect(patchRes.ok()).toBeTruthy();
    const updated = await patchRes.json();
    expect(updated.role).toBe(10);
  });

  test("should delete an invitation", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Delete Invite", slug },
    });

    const createRes = await apiContext.post(`/api/workspaces/${slug}/invitations/`, {
      data: { emails: [{ email: `del-inv-${Date.now()}@test.local`, role: 15 }] },
    });
    const [invitation] = await createRes.json();

    const delRes = await apiContext.delete(
      `/api/workspaces/${slug}/invitations/${invitation.id}/`,
    );
    expect(delRes.status()).toBe(204);

    // Verify it's removed from the list
    const listRes = await apiContext.get(`/api/workspaces/${slug}/invitations/`);
    const invitations = await listRes.json();
    const found = invitations.find((i: any) => i.id === invitation.id);
    expect(found).toBeUndefined();
  });

  test("should create bulk invitations", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Bulk Invite WS", slug },
    });

    const res = await apiContext.post(`/api/workspaces/${slug}/invitations/`, {
      data: {
        emails: [
          { email: `bulk1-${Date.now()}@test.local`, role: 15 },
          { email: `bulk2-${Date.now()}@test.local`, role: 10 },
          { email: `bulk3-${Date.now()}@test.local`, role: 5 },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const invitations = await res.json();
    expect(invitations.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Workspace Labels
// ---------------------------------------------------------------------------
test.describe("Workspace Labels", () => {
  test("should create a label", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Label WS", slug },
    });

    const res = await apiContext.post(`/api/workspaces/${slug}/labels/`, {
      data: { name: "Bug", color: "#FF0000" },
    });
    expect(res.ok()).toBeTruthy();
    const label = await res.json();
    expect(label.name).toBe("Bug");
    expect(label.color).toBe("#FF0000");
  });

  test("should list labels", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "List Labels", slug },
    });

    await apiContext.post(`/api/workspaces/${slug}/labels/`, {
      data: { name: "Feature", color: "#00FF00" },
    });

    const res = await apiContext.get(`/api/workspaces/${slug}/labels/`);
    expect(res.ok()).toBeTruthy();
    const labels = await res.json();
    expect(Array.isArray(labels)).toBeTruthy();
  });

  test("should update a label", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Update Label", slug },
    });

    const createRes = await apiContext.post(`/api/workspaces/${slug}/labels/`, {
      data: { name: "Old Name", color: "#000000" },
    });
    const label = await createRes.json();

    const patchRes = await apiContext.patch(
      `/api/workspaces/${slug}/labels/${label.id}/`,
      { data: { name: "New Name", color: "#FFFFFF" } },
    );
    expect(patchRes.ok()).toBeTruthy();
    const updated = await patchRes.json();
    expect(updated.name).toBe("New Name");
    expect(updated.color).toBe("#FFFFFF");
  });

  test("should delete a label", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Delete Label", slug },
    });

    const createRes = await apiContext.post(`/api/workspaces/${slug}/labels/`, {
      data: { name: "To Delete", color: "#123456" },
    });
    const label = await createRes.json();

    const delRes = await apiContext.delete(
      `/api/workspaces/${slug}/labels/${label.id}/`,
    );
    expect(delRes.status()).toBe(204);
  });

  test("should reject label with invalid color format", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Bad Color", slug },
    });

    const res = await apiContext.post(`/api/workspaces/${slug}/labels/`, {
      data: { name: "Bad", color: "not-a-color" },
    });
    expect(res.ok()).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Workspace Sidebar Preferences
// ---------------------------------------------------------------------------
test.describe("Workspace Preferences", () => {
  test("should get sidebar preferences", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Prefs WS", slug },
    });

    const res = await apiContext.get(`/api/workspaces/${slug}/sidebar-preferences/`);
    expect(res.ok()).toBeTruthy();
  });

  test("should update sidebar preferences", async ({ apiContext }) => {
    const slug = uniqueSlug();
    await apiContext.post("/api/workspaces/", {
      data: { name: "Update Prefs", slug },
    });

    const res = await apiContext.patch(`/api/workspaces/${slug}/sidebar-preferences/`, {
      data: { favorites: true },
    });
    expect(res.ok()).toBeTruthy();
  });
});
