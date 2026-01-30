import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunSQLite } from "bun:sqlite";
import { eq, and, desc, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as schema from "../../db/schema";
import { users } from "../../db/schema/user";
import {
  workspaces,
  recentVisits,
} from "../../db/schema/workspace";
import { issues, issueAssignees } from "../../db/schema/issue";
import { projects, projectMembers } from "../../db/schema/project";
import { pages } from "../../db/schema/page";

// Create an in-memory database for testing
const sqlite = new BunSQLite(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(sqlite, { schema });

const testUser = {
  id: createId(),
  email: "test@test.com",
  name: "Test User",
  isActive: true,
};

const testWorkspace = {
  id: createId(),
  name: "Test Workspace",
  slug: "test-workspace",
  ownerId: testUser.id,
};

const testProject = {
  id: createId(),
  workspaceId: testWorkspace.id,
  name: "Test Project",
  identifier: "TST",
};

function buildTestApp() {
  const app = new Hono<{ Variables: any }>();

  app.use("*", async (c, next) => {
    c.set("user", testUser);
    c.set("workspace", testWorkspace);
    await next();
  });

  app.get("/api/workspaces/:slug/recent-visits/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");

    const entityNameParam = c.req.query("entity_name");

    const conditions: any[] = [
      eq(recentVisits.workspaceId, workspace.id),
      eq(recentVisits.userId, user.id),
    ];

    const allowedEntities = ["issue", "page", "project"];
    if (entityNameParam && allowedEntities.includes(entityNameParam)) {
      conditions.push(eq(recentVisits.entityType, entityNameParam));
    } else {
      conditions.push(inArray(recentVisits.entityType, allowedEntities));
    }

    const visits = await testDb
      .select()
      .from(recentVisits)
      .where(and(...conditions))
      .orderBy(desc(recentVisits.visitedAt))
      .limit(20);

    const results = await Promise.all(
      visits.map(async (visit) => {
        let entityData: Record<string, unknown> | null = null;

        try {
          if (visit.entityType === "issue") {
            const issue = await testDb.query.issues.findFirst({
              where: eq(issues.id, visit.entityId),
            });
            if (issue) {
              const project = await testDb.query.projects.findFirst({
                where: eq(projects.id, issue.projectId),
              });
              const assigneeRows = await testDb
                .select({ assigneeId: issueAssignees.assigneeId })
                .from(issueAssignees)
                .where(eq(issueAssignees.issueId, issue.id));

              entityData = {
                id: issue.id,
                name: issue.name,
                state: issue.stateId,
                priority: issue.priority,
                assignees: assigneeRows.map((a) => a.assigneeId),
                type: issue.isEpic ? "epic" : null,
                sequence_id: issue.sequenceId,
                project_id: issue.projectId,
                project_identifier: project?.identifier ?? null,
                is_epic: issue.isEpic ?? false,
              };
            }
          } else if (visit.entityType === "project") {
            const project = await testDb.query.projects.findFirst({
              where: eq(projects.id, visit.entityId),
            });
            if (project) {
              const members = await testDb
                .select({ memberId: projectMembers.memberId })
                .from(projectMembers)
                .where(
                  and(
                    eq(projectMembers.projectId, project.id),
                    eq(projectMembers.isActive, true)
                  )
                );

              entityData = {
                id: project.id,
                name: project.name,
                logo_props: project.iconProp ?? {},
                project_members: members.map((m) => m.memberId),
                identifier: project.identifier,
              };
            }
          } else if (visit.entityType === "page") {
            const page = await testDb.query.pages.findFirst({
              where: eq(pages.id, visit.entityId),
            });
            if (page) {
              let projectIdentifier: string | null = null;
              if (page.projectId) {
                const project = await testDb.query.projects.findFirst({
                  where: eq(projects.id, page.projectId),
                });
                projectIdentifier = project?.identifier ?? null;
              }

              entityData = {
                id: page.id,
                name: page.name,
                logo_props: page.iconProp ? JSON.parse(page.iconProp as string) : {},
                project_id: page.projectId ?? null,
                owned_by: page.ownedById,
                project_identifier: projectIdentifier,
              };
            }
          }
        } catch {
          entityData = null;
        }

        return {
          id: visit.id,
          entity_name: visit.entityType,
          entity_identifier: visit.entityId,
          entity_data: entityData,
          visited_at: visit.visitedAt?.toISOString() ?? null,
        };
      })
    );

    return c.json(results);
  });

  return app;
}

beforeAll(async () => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER DEFAULT 0,
      name TEXT,
      image TEXT,
      username TEXT,
      display_name TEXT,
      avatar TEXT,
      cover_image TEXT,
      first_name TEXT,
      last_name TEXT,
      is_active INTEGER DEFAULT 1,
      is_password_autoset INTEGER DEFAULT 0,
      last_login_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS workspaces (
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

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      description_text TEXT,
      description_html TEXT,
      network INTEGER DEFAULT 2,
      identifier TEXT NOT NULL,
      emoji TEXT,
      icon_prop TEXT,
      cover_image TEXT,
      archive_in INTEGER DEFAULT 0,
      close_in INTEGER DEFAULT 0,
      default_assignee_id TEXT,
      default_state_id TEXT,
      project_lead_id TEXT,
      estimate_id TEXT,
      sort_order REAL DEFAULT 65535,
      created_by_id TEXT,
      logo_props TEXT,
      cycle_view INTEGER DEFAULT 1,
      module_view INTEGER DEFAULT 1,
      issue_views_view INTEGER DEFAULT 1,
      page_view INTEGER DEFAULT 1,
      intake_view INTEGER DEFAULT 0,
      guest_view_all_features INTEGER DEFAULT 0,
      is_time_tracking_enabled INTEGER DEFAULT 0,
      is_issue_type_enabled INTEGER DEFAULT 0,
      archived_at INTEGER,
      is_member_added INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER,
      UNIQUE(workspace_id, identifier)
    );

    CREATE TABLE IF NOT EXISTS project_members (
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

    CREATE TABLE IF NOT EXISTS states (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#858e96',
      "group" TEXT NOT NULL DEFAULT 'backlog',
      description TEXT,
      sequence REAL DEFAULT 65535,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(project_id, name)
    );

    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      parent_id TEXT,
      state_id TEXT REFERENCES states(id),
      name TEXT NOT NULL,
      description_html TEXT,
      description_stripped TEXT,
      description_binary TEXT,
      priority INTEGER DEFAULT 0,
      sort_order REAL DEFAULT 65535,
      start_date INTEGER,
      target_date INTEGER,
      completed_at INTEGER,
      archived_at INTEGER,
      sequence_id INTEGER,
      estimate_point INTEGER,
      is_epic INTEGER DEFAULT 0,
      created_by_id TEXT,
      updated_by_id TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS issue_assignees (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      assignee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER,
      UNIQUE(issue_id, assignee_id)
    );

    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      parent_id TEXT,
      name TEXT NOT NULL,
      description_html TEXT,
      description_stripped TEXT,
      description_binary BLOB,
      color_prop TEXT,
      icon_prop TEXT,
      cover_image TEXT,
      access_level INTEGER DEFAULT 0,
      is_locked INTEGER DEFAULT 0,
      owned_by_id TEXT REFERENCES users(id),
      archived_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS recent_visits (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      visited_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS recent_visit_user_workspace_idx ON recent_visits (user_id, workspace_id);
  `);

  await testDb.insert(users).values(testUser);
  await testDb.insert(workspaces).values(testWorkspace);
  await testDb.insert(projects).values(testProject);
});

describe("GET /api/workspaces/:slug/recent-visits/", () => {
  const app = buildTestApp();

  test("returns empty list when no visits exist", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/recent-visits/`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("returns issue visits with entity data", async () => {
    // Create an issue
    const issueId = createId();
    await testDb.insert(issues).values({
      id: issueId,
      projectId: testProject.id,
      workspaceId: testWorkspace.id,
      name: "Test Issue",
      priority: 2,
      sequenceId: 1,
    });

    // Add an assignee
    await testDb.insert(issueAssignees).values({
      issueId,
      assigneeId: testUser.id,
    });

    // Create a recent visit
    await testDb.insert(recentVisits).values({
      workspaceId: testWorkspace.id,
      userId: testUser.id,
      entityType: "issue",
      entityId: issueId,
      visitedAt: new Date(),
    });

    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/recent-visits/`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(1);
    expect(body[0].entity_name).toBe("issue");
    expect(body[0].entity_data).not.toBeNull();
    expect(body[0].entity_data.name).toBe("Test Issue");
    expect(body[0].entity_data.priority).toBe(2);
    expect(body[0].entity_data.project_identifier).toBe("TST");
    expect(body[0].entity_data.assignees).toEqual([testUser.id]);
    expect(body[0].entity_data.sequence_id).toBe(1);
  });

  test("returns project visits with entity data", async () => {
    // Add project member
    await testDb.insert(projectMembers).values({
      projectId: testProject.id,
      memberId: testUser.id,
      role: 20,
    });

    // Create a project visit
    await testDb.insert(recentVisits).values({
      workspaceId: testWorkspace.id,
      userId: testUser.id,
      entityType: "project",
      entityId: testProject.id,
      visitedAt: new Date(),
    });

    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/recent-visits/`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];

    const projectVisit = body.find((v: any) => v.entity_name === "project");
    expect(projectVisit).toBeDefined();
    expect(projectVisit.entity_data.name).toBe("Test Project");
    expect(projectVisit.entity_data.identifier).toBe("TST");
    expect(projectVisit.entity_data.project_members).toContain(testUser.id);
  });

  test("returns page visits with entity data", async () => {
    const pageId = createId();
    await testDb.insert(pages).values({
      id: pageId,
      workspaceId: testWorkspace.id,
      projectId: testProject.id,
      name: "Test Page",
      ownedById: testUser.id,
    });

    await testDb.insert(recentVisits).values({
      workspaceId: testWorkspace.id,
      userId: testUser.id,
      entityType: "page",
      entityId: pageId,
      visitedAt: new Date(),
    });

    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/recent-visits/`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];

    const pageVisit = body.find((v: any) => v.entity_name === "page");
    expect(pageVisit).toBeDefined();
    expect(pageVisit.entity_data.name).toBe("Test Page");
    expect(pageVisit.entity_data.owned_by).toBe(testUser.id);
    expect(pageVisit.entity_data.project_id).toBe(testProject.id);
    expect(pageVisit.entity_data.project_identifier).toBe("TST");
  });

  test("filters by entity_name query parameter", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/recent-visits/?entity_name=issue`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];

    // Should only return issue visits
    for (const visit of body) {
      expect(visit.entity_name).toBe("issue");
    }
  });

  test("returns entity_data as null for deleted entities", async () => {
    const missingId = createId();
    await testDb.insert(recentVisits).values({
      workspaceId: testWorkspace.id,
      userId: testUser.id,
      entityType: "issue",
      entityId: missingId,
      visitedAt: new Date(),
    });

    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/recent-visits/?entity_name=issue`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];

    const missingVisit = body.find(
      (v: any) => v.entity_identifier === missingId
    );
    expect(missingVisit).toBeDefined();
    expect(missingVisit.entity_data).toBeNull();
  });

  test("limits results to 20", async () => {
    // Add 25 visits
    for (let i = 0; i < 25; i++) {
      const id = createId();
      await testDb.insert(issues).values({
        id,
        projectId: testProject.id,
        workspaceId: testWorkspace.id,
        name: `Bulk Issue ${i}`,
      });
      await testDb.insert(recentVisits).values({
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        entityType: "issue",
        entityId: id,
        visitedAt: new Date(Date.now() + i * 1000),
      });
    }

    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/recent-visits/?entity_name=issue`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(20);
  });

  test("excludes non-allowed entity types", async () => {
    // Add a visit with an entity type not in allowed list
    await testDb.insert(recentVisits).values({
      workspaceId: testWorkspace.id,
      userId: testUser.id,
      entityType: "cycle",
      entityId: createId(),
      visitedAt: new Date(),
    });

    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/recent-visits/`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];

    // No cycle visits should appear
    const cycleVisits = body.filter((v: any) => v.entity_name === "cycle");
    expect(cycleVisits.length).toBe(0);
  });
});
