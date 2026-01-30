import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as userSchema from "../../db/schema/user";
import * as workspaceSchema from "../../db/schema/workspace";
import * as projectSchema from "../../db/schema/project";

// Create in-memory DB
const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

const db = drizzle(sqlite, {
  schema: { ...userSchema, ...workspaceSchema, ...projectSchema },
});

// Create tables
sqlite.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER,
    image TEXT,
    username TEXT UNIQUE,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    avatar TEXT,
    cover_image TEXT,
    is_active INTEGER DEFAULT 1,
    is_password_autoset INTEGER DEFAULT 0,
    last_login_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    logo TEXT,
    owner_id TEXT NOT NULL REFERENCES users(id),
    organization_size TEXT,
    timezone TEXT DEFAULT 'UTC',
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE workspace_members (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INTEGER NOT NULL DEFAULT 15,
    company_role TEXT,
    is_active INTEGER DEFAULT 1,
    view_props TEXT,
    default_props TEXT,
    issue_props TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(workspace_id, user_id)
  );

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL,
    description TEXT,
    description_text TEXT,
    description_html TEXT,
    network INTEGER DEFAULT 2,
    emoji TEXT,
    icon_prop TEXT,
    cover_image TEXT,
    archive_in INTEGER DEFAULT 0,
    close_in INTEGER DEFAULT 0,
    estimate_id TEXT,
    default_state_id TEXT,
    default_assignee_id TEXT,
    project_lead_id TEXT,
    created_by_id TEXT,
    sort_order REAL DEFAULT 65535,
    is_member_added INTEGER DEFAULT 0,
    inbox_view INTEGER DEFAULT 0,
    is_deployed INTEGER DEFAULT 0,
    deleted_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INTEGER NOT NULL DEFAULT 15,
    is_active INTEGER DEFAULT 1,
    view_props TEXT,
    default_props TEXT,
    preferences TEXT,
    sort_order REAL DEFAULT 65535,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(project_id, member_id)
  );
`);

// Test data
let testUser: { id: string; email: string };
let otherUser: { id: string; email: string };
let testWorkspace: { id: string; slug: string };
let otherWorkspace: { id: string; slug: string };
let project1: { id: string };
let project2: { id: string };
let project3: { id: string };

// Setup test app
const app = new Hono();

app.get("/api/users/me/workspaces/:slug/project-roles/", async (c) => {
  const slug = c.req.param("slug");

  // Verify user is an active workspace member
  const workspaceMembership = await db
    .select({ workspaceId: workspaceSchema.workspaces.id })
    .from(workspaceSchema.workspaceMembers)
    .innerJoin(
      workspaceSchema.workspaces,
      eq(workspaceSchema.workspaceMembers.workspaceId, workspaceSchema.workspaces.id)
    )
    .where(
      and(
        eq(workspaceSchema.workspaces.slug, slug),
        eq(workspaceSchema.workspaceMembers.userId, testUser.id),
        eq(workspaceSchema.workspaceMembers.isActive, true)
      )
    )
    .limit(1);

  if (workspaceMembership.length === 0) {
    return c.json({ detail: "You are not a member of this workspace." }, 403);
  }

  const workspaceId = workspaceMembership[0]!.workspaceId;

  // Get all active project memberships for this user in this workspace
  const memberships = await db
    .select({
      projectId: projectSchema.projectMembers.projectId,
      role: projectSchema.projectMembers.role,
    })
    .from(projectSchema.projectMembers)
    .innerJoin(
      projectSchema.projects,
      eq(projectSchema.projectMembers.projectId, projectSchema.projects.id)
    )
    .where(
      and(
        eq(projectSchema.projectMembers.memberId, testUser.id),
        eq(projectSchema.projectMembers.isActive, true),
        eq(projectSchema.projects.workspaceId, workspaceId)
      )
    );

  // Build {project_id: role} dictionary
  const projectRoles: Record<string, number> = {};
  for (const m of memberships) {
    projectRoles[m.projectId] = m.role;
  }

  return c.json(projectRoles);
});

beforeAll(async () => {
  // Create users
  testUser = {
    id: createId(),
    email: "test@example.com",
  };
  otherUser = {
    id: createId(),
    email: "other@example.com",
  };

  await db.insert(userSchema.users).values([
    { id: testUser.id, email: testUser.email, name: "Test User" },
    { id: otherUser.id, email: otherUser.email, name: "Other User" },
  ]);

  // Create workspaces
  testWorkspace = { id: createId(), slug: "test-workspace" };
  otherWorkspace = { id: createId(), slug: "other-workspace" };

  await db.insert(workspaceSchema.workspaces).values([
    { id: testWorkspace.id, name: "Test Workspace", slug: testWorkspace.slug, ownerId: testUser.id },
    { id: otherWorkspace.id, name: "Other Workspace", slug: otherWorkspace.slug, ownerId: otherUser.id },
  ]);

  // Add testUser as member of testWorkspace
  await db.insert(workspaceSchema.workspaceMembers).values({
    workspaceId: testWorkspace.id,
    userId: testUser.id,
    role: 20,
    isActive: true,
  });

  // Add otherUser as member of otherWorkspace
  await db.insert(workspaceSchema.workspaceMembers).values({
    workspaceId: otherWorkspace.id,
    userId: otherUser.id,
    role: 20,
    isActive: true,
  });

  // Create projects in testWorkspace
  project1 = { id: createId() };
  project2 = { id: createId() };
  project3 = { id: createId() };

  await db.insert(projectSchema.projects).values([
    {
      id: project1.id,
      workspaceId: testWorkspace.id,
      name: "Project Alpha",
      identifier: "ALPHA",
    },
    {
      id: project2.id,
      workspaceId: testWorkspace.id,
      name: "Project Beta",
      identifier: "BETA",
    },
    {
      id: project3.id,
      workspaceId: testWorkspace.id,
      name: "Project Gamma",
      identifier: "GAMMA",
    },
  ]);

  // Add testUser as member of project1 (Admin) and project2 (Member)
  await db.insert(projectSchema.projectMembers).values([
    {
      projectId: project1.id,
      memberId: testUser.id,
      role: 20, // Admin
      isActive: true,
    },
    {
      projectId: project2.id,
      memberId: testUser.id,
      role: 15, // Member
      isActive: true,
    },
  ]);

  // Add testUser as inactive member of project3
  await db.insert(projectSchema.projectMembers).values({
    projectId: project3.id,
    memberId: testUser.id,
    role: 15,
    isActive: false,
  });
});

describe("GET /api/users/me/workspaces/:slug/project-roles/", () => {
  test("returns project roles for authenticated user", async () => {
    const res = await app.request(
      `/api/users/me/workspaces/${testWorkspace.slug}/project-roles/`
    );
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data[project1.id]).toBe(20); // Admin
    expect(data[project2.id]).toBe(15); // Member
    // project3 should not appear (inactive)
    expect(data[project3.id]).toBeUndefined();
  });

  test("returns only active project memberships", async () => {
    const res = await app.request(
      `/api/users/me/workspaces/${testWorkspace.slug}/project-roles/`
    );
    const data = await res.json();

    // Should have exactly 2 projects (not the inactive one)
    expect(Object.keys(data).length).toBe(2);
  });

  test("returns 403 for non-member workspace", async () => {
    const res = await app.request(
      `/api/users/me/workspaces/${otherWorkspace.slug}/project-roles/`
    );
    expect(res.status).toBe(403);
  });

  test("returns 403 for non-existent workspace", async () => {
    const res = await app.request(
      `/api/users/me/workspaces/nonexistent-ws/project-roles/`
    );
    expect(res.status).toBe(403);
  });

  test("returns empty object when user has no project memberships", async () => {
    // Create a workspace where testUser is a member but has no projects
    const emptyWs = { id: createId(), slug: "empty-workspace" };
    await db.insert(workspaceSchema.workspaces).values({
      id: emptyWs.id,
      name: "Empty Workspace",
      slug: emptyWs.slug,
      ownerId: testUser.id,
    });
    await db.insert(workspaceSchema.workspaceMembers).values({
      workspaceId: emptyWs.id,
      userId: testUser.id,
      role: 20,
      isActive: true,
    });

    const res = await app.request(
      `/api/users/me/workspaces/${emptyWs.slug}/project-roles/`
    );
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Object.keys(data).length).toBe(0);
  });

  test("returns correct role values (Admin=20, Member=15, Guest=5)", async () => {
    // Add a Guest membership to project3 (reactivate as Guest)
    await db
      .update(projectSchema.projectMembers)
      .set({ role: 5, isActive: true })
      .where(
        and(
          eq(projectSchema.projectMembers.projectId, project3.id),
          eq(projectSchema.projectMembers.memberId, testUser.id)
        )
      );

    const res = await app.request(
      `/api/users/me/workspaces/${testWorkspace.slug}/project-roles/`
    );
    const data = await res.json();

    expect(data[project1.id]).toBe(20); // Admin
    expect(data[project2.id]).toBe(15); // Member
    expect(data[project3.id]).toBe(5); // Guest
    expect(Object.keys(data).length).toBe(3);

    // Reset project3 to inactive for other tests
    await db
      .update(projectSchema.projectMembers)
      .set({ isActive: false })
      .where(
        and(
          eq(projectSchema.projectMembers.projectId, project3.id),
          eq(projectSchema.projectMembers.memberId, testUser.id)
        )
      );
  });

  test("does not return projects from other workspaces", async () => {
    // Create a project in otherWorkspace and add testUser as member
    const otherProject = { id: createId() };
    await db.insert(projectSchema.projects).values({
      id: otherProject.id,
      workspaceId: otherWorkspace.id,
      name: "Other Project",
      identifier: "OTHER",
    });

    // Add testUser to otherWorkspace first
    try {
      await db.insert(workspaceSchema.workspaceMembers).values({
        workspaceId: otherWorkspace.id,
        userId: testUser.id,
        role: 15,
        isActive: true,
      });
    } catch {
      // May already exist
    }

    await db.insert(projectSchema.projectMembers).values({
      projectId: otherProject.id,
      memberId: testUser.id,
      role: 20,
      isActive: true,
    });

    // Query testWorkspace - should NOT include otherProject
    const res = await app.request(
      `/api/users/me/workspaces/${testWorkspace.slug}/project-roles/`
    );
    const data = await res.json();

    expect(data[otherProject.id]).toBeUndefined();
  });
});
