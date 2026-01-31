import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import { workspaces, workspaceMembers } from "../../db/schema/workspace";
import { projects, projectMembers, states } from "../../db/schema/project";
import { issues } from "../../db/schema/issue";
import { cycles } from "../../db/schema/cycle";
import { modules } from "../../db/schema/module";
import { views } from "../../db/schema/view";
import { pages } from "../../db/schema/page";
import { intakeIssues } from "../../db/schema/intake";
import { intakes } from "../../db/schema/intake";
import { eq, and, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

type Variables = any;
const app = new Hono<{ Variables: Variables }>();

const userId = createId();
const workspaceId = createId();
const workspaceSlug = "search-ws-" + createId().slice(0, 6);
const projectId = createId();
const project2Id = createId();
const stateId = createId();
const issueId1 = createId();
const issueId2 = createId();
const cycleId = createId();
const moduleId = createId();
const viewId = createId();
const pageId = createId();
const intakeId = createId();
const intakeIssueId = createId();

// Fake middleware
app.use("*", async (c, next) => {
  const uid = c.req.header("x-test-user");
  if (!uid) return c.json({ detail: "Auth required" }, 401);
  c.set("user", { id: uid, email: "test@test.com", name: "Test" });
  c.set("session", { id: "s", userId: uid, expiresAt: new Date() });
  c.set("workspace", { id: workspaceId, name: "Search WS", slug: workspaceSlug, ownerId: userId });
  c.set("workspaceMembership", { id: "wm", workspaceId, userId: uid, role: 20 });
  await next();
});

import { sql, like, isNull, desc, or, isNotNull } from "drizzle-orm";

// ---- Inline search route (mirrors workspace routes) ----

function computeCycleStatus(startDate: Date | null, endDate: Date | null): string {
  const now = new Date();
  if (startDate && endDate && startDate <= now && endDate >= now) return "CURRENT";
  if (startDate && startDate > now) return "UPCOMING";
  if (endDate && endDate < now) return "COMPLETED";
  if (!startDate && !endDate) return "DRAFT";
  return "DRAFT";
}

// GET /search/
app.get("/api/workspaces/:slug/search/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  const query = c.req.query("search") || "";
  const entitiesParam = c.req.query("entities") || "";
  const workspaceSearch = c.req.query("workspace_search") || "false";
  const projectIdParam = c.req.query("project_id") || "";

  const allEntities = ["workspace", "project", "issue", "cycle", "module", "issue_view", "page", "intake"];
  let requestedEntities: string[];
  if (entitiesParam) {
    requestedEntities = entitiesParam.split(",").map((e) => e.trim()).filter((e) => allEntities.includes(e));
  } else {
    requestedEntities = allEntities;
  }

  const userProjectMemberships = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(
      eq(projectMembers.memberId, user.id),
      eq(projects.workspaceId, workspace.id),
      isNull(projects.archivedAt),
    ));
  const userProjectIds = userProjectMemberships.map((m: any) => m.projectId);

  const results: Record<string, unknown[]> = {};

  for (const entity of requestedEntities) {
    if (entity === "workspace") {
      const ws = await db
        .select({ name: workspaces.name, id: workspaces.id, slug: workspaces.slug })
        .from(workspaces)
        .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(and(
          eq(workspaceMembers.userId, user.id),
          query ? like(workspaces.name, `%${query}%`) : undefined,
        ))
        .orderBy(desc(workspaces.createdAt));
      results.workspace = ws;
    }

    if (entity === "project") {
      if (userProjectIds.length === 0) { results.project = []; continue; }
      const projectRows = await db
        .select({
          name: projects.name,
          id: projects.id,
          identifier: projects.identifier,
          workspace__slug: sql<string>`${workspace.slug}`.as("workspace__slug"),
        })
        .from(projects)
        .where(and(
          inArray(projects.id, userProjectIds),
          eq(projects.workspaceId, workspace.id),
          isNull(projects.archivedAt),
          query ? or(like(projects.name, `%${query}%`), like(projects.identifier, `%${query}%`)) : undefined,
        ))
        .orderBy(desc(projects.createdAt));
      results.project = projectRows;
    }

    if (entity === "issue") {
      if (userProjectIds.length === 0) { results.issue = []; continue; }
      const conditions: any[] = [
        eq(issues.workspaceId, workspace.id),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt),
        inArray(issues.projectId, userProjectIds),
      ];
      if (workspaceSearch === "false" && projectIdParam) {
        conditions.push(eq(issues.projectId, projectIdParam));
      }
      if (query) {
        const orConditions: any[] = [like(issues.name, `%${query}%`)];
        const sequences = query.match(/\b\d+\b/g);
        if (sequences) {
          for (const seq of sequences) {
            orConditions.push(eq(issues.sequenceId, parseInt(seq, 10)));
          }
        }
        conditions.push(or(...orConditions));
      }
      const issueRows = await db
        .select({
          name: issues.name,
          id: issues.id,
          sequence_id: issues.sequenceId,
          project_id: issues.projectId,
        })
        .from(issues)
        .where(and(...conditions))
        .orderBy(desc(issues.createdAt))
        .limit(100);

      const issueProjectIds = [...new Set(issueRows.map((i: any) => i.project_id))];
      const projectLookup = new Map<string, string>();
      if (issueProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, issueProjectIds));
        for (const p of projRows) projectLookup.set(p.id, p.identifier);
      }
      results.issue = issueRows.map((i: any) => ({
        ...i,
        project__identifier: projectLookup.get(i.project_id) ?? "",
      }));
    }

    if (entity === "cycle") {
      if (userProjectIds.length === 0) { results.cycle = []; continue; }
      const conditions: any[] = [
        eq(cycles.workspaceId, workspace.id),
        inArray(cycles.projectId, userProjectIds),
      ];
      if (query) conditions.push(like(cycles.name, `%${query}%`));
      const cycleRows = await db
        .select({ name: cycles.name, id: cycles.id, project_id: cycles.projectId, startDate: cycles.startDate, endDate: cycles.endDate })
        .from(cycles)
        .where(and(...conditions))
        .orderBy(desc(cycles.createdAt));
      const cycleProjectIds = [...new Set(cycleRows.map((c: any) => c.project_id))];
      const cycleProjLookup = new Map<string, string>();
      if (cycleProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, cycleProjectIds));
        for (const p of projRows) cycleProjLookup.set(p.id, p.identifier);
      }
      results.cycle = cycleRows.map((c: any) => ({
        name: c.name, id: c.id, project_id: c.project_id,
        project__identifier: cycleProjLookup.get(c.project_id) ?? "",
        status: computeCycleStatus(c.startDate, c.endDate),
      }));
    }

    if (entity === "module") {
      if (userProjectIds.length === 0) { results.module = []; continue; }
      const conditions: any[] = [eq(modules.workspaceId, workspace.id), inArray(modules.projectId, userProjectIds)];
      if (query) conditions.push(like(modules.name, `%${query}%`));
      const moduleRows = await db
        .select({ name: modules.name, id: modules.id, project_id: modules.projectId, status: modules.status })
        .from(modules)
        .where(and(...conditions))
        .orderBy(desc(modules.createdAt));
      const moduleProjectIds = [...new Set(moduleRows.map((m: any) => m.project_id))];
      const moduleProjLookup = new Map<string, string>();
      if (moduleProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, moduleProjectIds));
        for (const p of projRows) moduleProjLookup.set(p.id, p.identifier);
      }
      results.module = moduleRows.map((m: any) => ({ ...m, project__identifier: moduleProjLookup.get(m.project_id) ?? "" }));
    }

    if (entity === "issue_view") {
      if (userProjectIds.length === 0) { results.issue_view = []; continue; }
      const conditions: any[] = [eq(views.workspaceId, workspace.id), inArray(views.projectId, userProjectIds)];
      if (query) conditions.push(like(views.name, `%${query}%`));
      const viewRows = await db
        .select({ name: views.name, id: views.id, project_id: views.projectId })
        .from(views)
        .where(and(...conditions))
        .orderBy(desc(views.createdAt));
      results.issue_view = viewRows;
    }

    if (entity === "page") {
      const conditions: any[] = [eq(pages.workspaceId, workspace.id)];
      if (query) conditions.push(like(pages.name, `%${query}%`));
      const pageRows = await db
        .select({ name: pages.name, id: pages.id, project_ids: pages.projectId })
        .from(pages)
        .where(and(...conditions))
        .orderBy(desc(pages.createdAt));
      results.page = pageRows.map((p: any) => ({ name: p.name, id: p.id, project_ids: p.project_ids ? [p.project_ids] : [] }));
    }

    if (entity === "intake") {
      if (userProjectIds.length === 0) { results.intake = []; continue; }
      const conditions: any[] = [
        eq(issues.workspaceId, workspace.id),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt),
        inArray(issues.projectId, userProjectIds),
        or(eq(intakeIssues.status, 0), eq(intakeIssues.status, -2)),
      ];
      if (query) {
        conditions.push(like(issues.name, `%${query}%`));
      }
      const intakeRows = await db
        .select({ name: issues.name, id: issues.id, sequence_id: issues.sequenceId, project_id: issues.projectId })
        .from(issues)
        .innerJoin(intakeIssues, eq(intakeIssues.issueId, issues.id))
        .where(and(...conditions))
        .orderBy(desc(issues.createdAt))
        .limit(100);
      results.intake = intakeRows;
    }
  }

  return c.json({ results });
});

// GET /entity-search/
app.get("/api/workspaces/:slug/entity-search/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  const query = c.req.query("query") || "";
  const queryTypesParam = c.req.query("query_type") || "user_mention";
  const queryTypes = queryTypesParam.split(",").map((t: string) => t.trim());
  const countLimit = Math.min(parseInt(c.req.query("count") || "5", 10) || 5, 100);
  const projectIdParam = c.req.query("project_id") || "";

  const userProjectMemberships = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(
      eq(projectMembers.memberId, user.id),
      eq(projects.workspaceId, workspace.id),
      isNull(projects.archivedAt),
    ));
  const userProjectIds = userProjectMemberships.map((m: any) => m.projectId);

  const responseData: Record<string, unknown[]> = {};

  for (const queryType of queryTypes) {
    if (queryType === "user_mention") {
      const conditions: any[] = [eq(workspaceMembers.workspaceId, workspace.id)];
      if (query) {
        conditions.push(
          sql`EXISTS (SELECT 1 FROM users WHERE users.id = ${workspaceMembers.userId} AND (users.display_name LIKE ${'%' + query + '%'} OR users.name LIKE ${'%' + query + '%'}))`
        );
      }
      const members = await db
        .select({ member__id: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(and(...conditions))
        .orderBy(desc(workspaceMembers.createdAt))
        .limit(countLimit);

      const memberIds = members.map((m: any) => m.member__id);
      if (memberIds.length > 0) {
        const userRows = await db
          .select({ id: users.id, displayName: users.displayName, avatar: users.avatar })
          .from(users)
          .where(inArray(users.id, memberIds));
        const userMap = new Map(userRows.map((u: any) => [u.id, u]));
        responseData.user_mention = members.map((m: any) => {
          const u = userMap.get(m.member__id);
          return { member__id: m.member__id, member__display_name: u?.displayName ?? "", member__avatar_url: u?.avatar ?? null };
        });
      } else {
        responseData.user_mention = [];
      }
    }

    if (queryType === "issue") {
      if (userProjectIds.length === 0) { responseData.issue = []; continue; }
      const conditions: any[] = [
        eq(issues.workspaceId, workspace.id),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt),
        projectIdParam ? eq(issues.projectId, projectIdParam) : inArray(issues.projectId, userProjectIds),
      ];
      if (query) {
        const orConditions: any[] = [like(issues.name, `%${query}%`)];
        const sequences = query.match(/\b\d+\b/g);
        if (sequences) {
          for (const seq of sequences) {
            orConditions.push(eq(issues.sequenceId, parseInt(seq, 10)));
          }
        }
        conditions.push(or(...orConditions));
      }
      const issueRows = await db
        .select({
          name: issues.name, id: issues.id, sequence_id: issues.sequenceId,
          project_id: issues.projectId, priority: issues.priority, state_id: issues.stateId,
        })
        .from(issues)
        .where(and(...conditions))
        .orderBy(desc(issues.createdAt))
        .limit(countLimit);

      const issueProjectIds = [...new Set(issueRows.map((i: any) => i.project_id))];
      const projLookup = new Map<string, string>();
      if (issueProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, issueProjectIds));
        for (const p of projRows) projLookup.set(p.id, p.identifier);
      }
      responseData.issue = issueRows.map((i: any) => ({
        ...i, type_id: null, project__identifier: projLookup.get(i.project_id) ?? "",
      }));
    }

    if (queryType === "project") {
      const conditions: any[] = [eq(projects.workspaceId, workspace.id)];
      if (query) conditions.push(or(like(projects.name, `%${query}%`), like(projects.identifier, `%${query}%`)));
      if (userProjectIds.length > 0) {
        conditions.push(or(inArray(projects.id, userProjectIds), eq(projects.network, 2)));
      } else {
        conditions.push(eq(projects.network, 2));
      }
      const projectRows = await db
        .select({ name: projects.name, id: projects.id, identifier: projects.identifier, logo_props: projects.logoProps, workspace__slug: sql<string>`${workspace.slug}`.as("ws") })
        .from(projects)
        .where(and(...conditions))
        .orderBy(desc(projects.createdAt))
        .limit(countLimit);
      responseData.project = projectRows;
    }

    if (queryType === "cycle") {
      if (userProjectIds.length === 0) { responseData.cycle = []; continue; }
      const conditions: any[] = [eq(cycles.workspaceId, workspace.id), inArray(cycles.projectId, userProjectIds)];
      if (query) conditions.push(like(cycles.name, `%${query}%`));
      const cycleRows = await db
        .select({ name: cycles.name, id: cycles.id, project_id: cycles.projectId, startDate: cycles.startDate, endDate: cycles.endDate })
        .from(cycles)
        .where(and(...conditions))
        .orderBy(desc(cycles.createdAt))
        .limit(countLimit);
      const cycleProjectIds = [...new Set(cycleRows.map((c: any) => c.project_id))];
      const cycleProjLookup = new Map<string, string>();
      if (cycleProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, cycleProjectIds));
        for (const p of projRows) cycleProjLookup.set(p.id, p.identifier);
      }
      responseData.cycle = cycleRows.map((c: any) => ({
        name: c.name, id: c.id, project_id: c.project_id,
        project__identifier: cycleProjLookup.get(c.project_id) ?? "",
        status: computeCycleStatus(c.startDate, c.endDate),
      }));
    }

    if (queryType === "module") {
      if (userProjectIds.length === 0) { responseData.module = []; continue; }
      const conditions: any[] = [eq(modules.workspaceId, workspace.id), inArray(modules.projectId, userProjectIds)];
      if (query) conditions.push(like(modules.name, `%${query}%`));
      const moduleRows = await db
        .select({ name: modules.name, id: modules.id, project_id: modules.projectId, status: modules.status })
        .from(modules)
        .where(and(...conditions))
        .orderBy(desc(modules.createdAt))
        .limit(countLimit);
      const moduleProjectIds = [...new Set(moduleRows.map((m: any) => m.project_id))];
      const moduleProjLookup = new Map<string, string>();
      if (moduleProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, moduleProjectIds));
        for (const p of projRows) moduleProjLookup.set(p.id, p.identifier);
      }
      responseData.module = moduleRows.map((m: any) => ({ ...m, project__identifier: moduleProjLookup.get(m.project_id) ?? "" }));
    }

    if (queryType === "page") {
      const conditions: any[] = [eq(pages.workspaceId, workspace.id), eq(pages.accessLevel, 0)];
      if (query) conditions.push(like(pages.name, `%${query}%`));
      const pageRows = await db
        .select({ name: pages.name, id: pages.id, projects__id: pages.projectId })
        .from(pages)
        .where(and(...conditions))
        .orderBy(desc(pages.createdAt))
        .limit(countLimit);
      responseData.page = pageRows;
    }
  }

  return c.json(responseData);
});

function h(uid: string = userId) {
  return { "x-test-user": uid, "Content-Type": "application/json" };
}

describe("Search Endpoints", () => {
  beforeAll(async () => {
    await db.insert(users).values({ id: userId, email: "search-test@test.com", name: "Search Test", displayName: "Search User", emailVerified: true });
    await db.insert(workspaces).values({ id: workspaceId, name: "Search WS", slug: workspaceSlug, ownerId: userId });
    await db.insert(workspaceMembers).values({ id: createId(), workspaceId, userId, role: 20 });
    await db.insert(projects).values([
      { id: projectId, workspaceId, name: "Alpha Project", identifier: "ALPHA", createdById: userId },
      { id: project2Id, workspaceId, name: "Beta Project", identifier: "BETA", createdById: userId },
    ]);
    await db.insert(projectMembers).values([
      { id: createId(), projectId, memberId: userId, role: 20 },
      { id: createId(), projectId: project2Id, memberId: userId, role: 20 },
    ]);
    await db.insert(states).values({ id: stateId, projectId, workspaceId, name: "Backlog", group: "backlog", color: "#ccc" });

    await db.insert(issues).values([
      { id: issueId1, projectId, workspaceId, name: "Fix login bug", stateId, createdById: userId, sequenceId: 1 },
      { id: issueId2, projectId, workspaceId, name: "Add dashboard feature", stateId, createdById: userId, sequenceId: 2 },
    ]);

    await db.insert(cycles).values({
      id: cycleId, projectId, workspaceId, name: "Sprint Alpha",
      startDate: new Date("2025-01-01"), endDate: new Date("2030-12-31"), ownedById: userId,
    });

    await db.insert(modules).values({
      id: moduleId, projectId, workspaceId, name: "Auth Module", status: "in-progress",
    });

    await db.insert(views).values({
      id: viewId, workspaceId, projectId, name: "My Open Issues", query: {},
    });

    await db.insert(pages).values({
      id: pageId, workspaceId, projectId, name: "Getting Started Guide", accessLevel: 0, ownedById: userId,
    });

    // Intake issue
    await db.insert(intakes).values({ id: intakeId, projectId, workspaceId, name: "Default Intake" });
    const intakeIssueIssueId = createId();
    const intakeStateId = createId();
    await db.insert(states).values({ id: intakeStateId, projectId, workspaceId, name: "Triage", group: "triage", color: "#eee" });
    await db.insert(issues).values({
      id: intakeIssueIssueId, projectId, workspaceId, name: "Intake request from customer", stateId: intakeStateId, createdById: userId, sequenceId: 3,
    });
    await db.insert(intakeIssues).values({
      id: intakeIssueId, intakeId, issueId: intakeIssueIssueId, projectId, workspaceId, status: -2, createdById: userId,
    });
  });

  afterAll(async () => {
    await db.delete(intakeIssues).where(eq(intakeIssues.intakeId, intakeId)).catch(() => {});
    await db.delete(intakes).where(eq(intakes.id, intakeId)).catch(() => {});
    await db.delete(pages).where(eq(pages.workspaceId, workspaceId)).catch(() => {});
    await db.delete(views).where(eq(views.workspaceId, workspaceId)).catch(() => {});
    await db.delete(modules).where(eq(modules.workspaceId, workspaceId)).catch(() => {});
    await db.delete(cycles).where(eq(cycles.workspaceId, workspaceId)).catch(() => {});
    await db.delete(issues).where(eq(issues.workspaceId, workspaceId)).catch(() => {});
    await db.delete(states).where(eq(states.workspaceId, workspaceId)).catch(() => {});
    await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId)).catch(() => {});
    await db.delete(projectMembers).where(eq(projectMembers.projectId, project2Id)).catch(() => {});
    await db.delete(projects).where(eq(projects.workspaceId, workspaceId)).catch(() => {});
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId)).catch(() => {});
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId)).catch(() => {});
    await db.delete(users).where(eq(users.id, userId)).catch(() => {});
  });

  // ---- Global Search ----

  test("global search returns all entity types", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/search/?search=&workspace_search=true`, { headers: h() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toBeDefined();
    expect(data.results.workspace).toBeDefined();
    expect(data.results.project).toBeDefined();
    expect(data.results.issue).toBeDefined();
    expect(data.results.cycle).toBeDefined();
    expect(data.results.module).toBeDefined();
    expect(data.results.issue_view).toBeDefined();
    expect(data.results.page).toBeDefined();
    expect(data.results.intake).toBeDefined();
  });

  test("global search filters by query", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/search/?search=login&workspace_search=true`, { headers: h() });
    const data = await res.json();
    expect(data.results.issue.length).toBe(1);
    expect(data.results.issue[0].name).toBe("Fix login bug");
  });

  test("global search filters specific entities", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/search/?search=Alpha&entities=project,cycle&workspace_search=true`, { headers: h() });
    const data = await res.json();
    expect(data.results.project).toBeDefined();
    expect(data.results.cycle).toBeDefined();
    expect(data.results.issue).toBeUndefined();
  });

  test("global search finds projects by name", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/search/?search=Alpha&entities=project&workspace_search=true`, { headers: h() });
    const data = await res.json();
    expect(data.results.project.length).toBe(1);
    expect(data.results.project[0].name).toBe("Alpha Project");
  });

  test("global search finds cycles", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/search/?search=Sprint&entities=cycle&workspace_search=true`, { headers: h() });
    const data = await res.json();
    expect(data.results.cycle.length).toBe(1);
    expect(data.results.cycle[0].name).toBe("Sprint Alpha");
    expect(data.results.cycle[0].status).toBe("CURRENT");
  });

  test("global search finds modules", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/search/?search=Auth&entities=module&workspace_search=true`, { headers: h() });
    const data = await res.json();
    expect(data.results.module.length).toBe(1);
    expect(data.results.module[0].name).toBe("Auth Module");
  });

  test("global search finds views", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/search/?search=Open&entities=issue_view&workspace_search=true`, { headers: h() });
    const data = await res.json();
    expect(data.results.issue_view.length).toBe(1);
    expect(data.results.issue_view[0].name).toBe("My Open Issues");
  });

  test("global search finds pages", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/search/?search=Getting&entities=page&workspace_search=true`, { headers: h() });
    const data = await res.json();
    expect(data.results.page.length).toBe(1);
    expect(data.results.page[0].name).toBe("Getting Started Guide");
  });

  test("global search finds intake issues", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/search/?search=Intake&entities=intake&workspace_search=true`, { headers: h() });
    const data = await res.json();
    expect(data.results.intake.length).toBe(1);
    expect(data.results.intake[0].name).toBe("Intake request from customer");
  });

  test("global search issue includes project__identifier", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/search/?search=login&entities=issue&workspace_search=true`, { headers: h() });
    const data = await res.json();
    expect(data.results.issue[0].project__identifier).toBe("ALPHA");
  });

  test("global search by sequence_id", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/search/?search=1&entities=issue&workspace_search=true`, { headers: h() });
    const data = await res.json();
    const ids = data.results.issue.map((i: any) => i.id);
    expect(ids).toContain(issueId1);
  });

  // ---- Entity Search ----

  test("entity search user_mention returns members", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/entity-search/?query_type=user_mention&query=Search`, { headers: h() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user_mention).toBeDefined();
    expect(data.user_mention.length).toBeGreaterThanOrEqual(1);
    expect(data.user_mention[0].member__display_name).toBe("Search User");
  });

  test("entity search issue returns issues with details", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/entity-search/?query_type=issue&query=dashboard&project_id=${projectId}`, { headers: h() });
    const data = await res.json();
    expect(data.issue.length).toBe(1);
    expect(data.issue[0].name).toBe("Add dashboard feature");
    expect(data.issue[0].project__identifier).toBe("ALPHA");
  });

  test("entity search project returns projects", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/entity-search/?query_type=project&query=Beta`, { headers: h() });
    const data = await res.json();
    expect(data.project.length).toBe(1);
    expect(data.project[0].name).toBe("Beta Project");
  });

  test("entity search multiple types", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/entity-search/?query_type=cycle,module&query=`, { headers: h() });
    const data = await res.json();
    expect(data.cycle).toBeDefined();
    expect(data.module).toBeDefined();
    expect(data.cycle.length).toBeGreaterThanOrEqual(1);
    expect(data.module.length).toBeGreaterThanOrEqual(1);
  });

  test("entity search respects count limit", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/entity-search/?query_type=issue&query=&count=1`, { headers: h() });
    const data = await res.json();
    expect(data.issue.length).toBeLessThanOrEqual(1);
  });

  test("entity search page respects access level", async () => {
    // Our page has accessLevel=0 (private), should appear
    const res = await app.request(`/api/workspaces/${workspaceSlug}/entity-search/?query_type=page&query=Getting`, { headers: h() });
    const data = await res.json();
    expect(data.page.length).toBe(1);
  });

  test("returns 401 without auth", async () => {
    const res = await app.request(`/api/workspaces/${workspaceSlug}/search/`);
    expect(res.status).toBe(401);
  });
});
