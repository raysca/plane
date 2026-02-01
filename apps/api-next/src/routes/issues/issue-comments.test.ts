import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as userSchema from "../../db/schema/user";
import * as workspaceSchema from "../../db/schema/workspace";
import * as projectSchema from "../../db/schema/project";
import * as issueSchema from "../../db/schema/issue";

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

const db = drizzle(sqlite, {
  schema: {
    ...userSchema,
    ...workspaceSchema,
    ...projectSchema,
    ...issueSchema,
  },
});

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

  CREATE TABLE projects (
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
    default_assignee_id TEXT REFERENCES users(id),
    default_state_id TEXT,
    project_lead_id TEXT REFERENCES users(id),
    estimate_id TEXT,
    sort_order REAL DEFAULT 65535,
    created_by_id TEXT REFERENCES users(id),
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
    deleted_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(workspace_id, identifier)
  );

  CREATE TABLE project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INTEGER DEFAULT 15,
    is_active INTEGER DEFAULT 1,
    view_props TEXT,
    default_props TEXT,
    preferences TEXT,
    sort_order REAL DEFAULT 65535,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(project_id, member_id)
  );

  CREATE TABLE states (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    "group" TEXT NOT NULL,
    description TEXT,
    sequence REAL DEFAULT 65535,
    is_default INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE issues (
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
    created_by_id TEXT REFERENCES users(id),
    updated_by_id TEXT REFERENCES users(id),
    created_at INTEGER,
    updated_at INTEGER,
    deleted_at INTEGER
  );

  CREATE TABLE issue_comments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES users(id),
    comment_html TEXT,
    comment_stripped TEXT,
    comment_json TEXT,
    access TEXT DEFAULT 'INTERNAL',
    parent_id TEXT,
    edited_at INTEGER,
    external_source TEXT,
    external_id TEXT,
    created_by_id TEXT REFERENCES users(id),
    updated_by_id TEXT REFERENCES users(id),
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE comment_reactions (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL REFERENCES issue_comments(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES users(id),
    reaction TEXT NOT NULL,
    created_at INTEGER,
    UNIQUE(comment_id, actor_id, reaction)
  );

  CREATE TABLE issue_activities (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id TEXT REFERENCES users(id),
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    verb TEXT NOT NULL,
    old_identifier TEXT,
    new_identifier TEXT,
    epoch_timestamp INTEGER,
    created_at INTEGER
  );
`);

let testUser: { id: string; email: string; name: string };
let otherUser: { id: string; email: string; name: string };
let workspace: { id: string; slug: string; name: string };
let project: { id: string; name: string; identifier: string };
let testIssue: typeof issueSchema.issues.$inferSelect;

function getCurrentUser(c: any) {
  const userId = c.req.header("x-test-user-id");
  if (userId === testUser?.id) return testUser;
  if (userId === otherUser?.id) return otherUser;
  return null;
}

const app = new Hono();

// --- Comment CRUD routes (mirroring the real implementation) ---

// GET /:issueId/comments/
app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/comments/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");

  const comments = await db.query.issueComments.findMany({
    where: eq(issueSchema.issueComments.issueId, issueId),
    orderBy: [asc(issueSchema.issueComments.createdAt)],
  });

  // Fetch actors
  const actorIds = [...new Set(comments.map((co) => co.actorId))];
  const actorRows =
    actorIds.length > 0
      ? await db.select().from(userSchema.users).where(inArray(userSchema.users.id, actorIds))
      : [];
  const actorMap = new Map(actorRows.map((a) => [a.id, a]));

  // Fetch reactions
  const commentIds = comments.map((co) => co.id);
  const reactionRows =
    commentIds.length > 0
      ? await db.select().from(issueSchema.commentReactions).where(inArray(issueSchema.commentReactions.commentId, commentIds))
      : [];
  const reactionsByComment = new Map<string, (typeof reactionRows)[number][]>();
  for (const r of reactionRows) {
    const arr = reactionsByComment.get(r.commentId) ?? [];
    arr.push(r);
    reactionsByComment.set(r.commentId, arr);
  }

  return c.json(
    comments.map((co) => {
      const actor = actorMap.get(co.actorId);
      return {
        id: co.id,
        issue: co.issueId,
        workspace: co.workspaceId,
        project: co.projectId,
        actor: co.actorId,
        comment_html: co.commentHtml ?? "",
        comment_stripped: co.commentStripped ?? "",
        comment_json: co.commentJson ?? null,
        attachments: [],
        access: co.access ?? "INTERNAL",
        parent: co.parentId ?? null,
        edited_at: co.editedAt?.toISOString() ?? null,
        external_source: co.externalSource ?? null,
        external_id: co.externalId ?? null,
        created_by: co.createdById ?? null,
        updated_by: co.updatedById ?? null,
        created_at: co.createdAt?.toISOString() ?? null,
        updated_at: co.updatedAt?.toISOString() ?? null,
        actor_detail: actor
          ? {
              id: actor.id,
              display_name: actor.displayName ?? actor.name ?? "",
              first_name: actor.name ?? "",
              last_name: "",
              avatar_url: actor.avatar ?? null,
              is_bot: false,
            }
          : null,
        comment_reactions: (reactionsByComment.get(co.id) ?? []).map((r) => ({
          id: r.id,
          comment_id: r.commentId,
          actor_id: r.actorId,
          reaction: r.reaction,
          created_at: r.createdAt?.toISOString() ?? null,
        })),
        workspace_detail: { id: workspace.id, name: workspace.name, slug: workspace.slug },
        project_detail: { id: project.id, identifier: project.identifier, name: project.name },
        is_member: true,
      };
    })
  );
});

// GET /:issueId/comments/:commentId/
app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/comments/:commentId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const commentId = c.req.param("commentId");
  const issueId = c.req.param("issueId");

  const comment = await db.query.issueComments.findFirst({
    where: and(eq(issueSchema.issueComments.id, commentId), eq(issueSchema.issueComments.issueId, issueId)),
  });

  if (!comment) return c.json({ detail: "Comment not found." }, 404);

  const actor = await db.query.users.findFirst({ where: eq(userSchema.users.id, comment.actorId) });

  return c.json({
    id: comment.id,
    issue: comment.issueId,
    workspace: comment.workspaceId,
    project: comment.projectId,
    actor: comment.actorId,
    comment_html: comment.commentHtml ?? "",
    comment_stripped: comment.commentStripped ?? "",
    access: comment.access ?? "INTERNAL",
    edited_at: comment.editedAt?.toISOString() ?? null,
    created_by: comment.createdById ?? null,
    updated_by: comment.updatedById ?? null,
    created_at: comment.createdAt?.toISOString() ?? null,
    updated_at: comment.updatedAt?.toISOString() ?? null,
    actor_detail: actor
      ? { id: actor.id, display_name: actor.displayName ?? actor.name ?? "" }
      : null,
    comment_reactions: [],
  });
});

// POST /:issueId/comments/
app.post("/api/workspaces/:slug/projects/:projectId/issues/:issueId/comments/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");
  const body = await c.req.json();

  const result = await db
    .insert(issueSchema.issueComments)
    .values({
      issueId,
      projectId: project.id,
      workspaceId: workspace.id,
      actorId: user.id,
      commentHtml: body.comment_html,
      commentStripped: body.comment_stripped,
      commentJson: body.comment_json,
      access: body.access ?? "INTERNAL",
      parentId: body.parent_id ?? null,
      createdById: user.id,
      updatedById: user.id,
    })
    .returning();

  // Record activity
  await db.insert(issueSchema.issueActivities).values({
    issueId,
    projectId: project.id,
    workspaceId: workspace.id,
    actorId: user.id,
    field: "comment",
    verb: "created",
    newValue: result[0]!.id,
    epochTimestamp: Math.floor(Date.now() / 1000),
  });

  const comment = result[0]!;
  return c.json(
    {
      id: comment.id,
      issue: comment.issueId,
      workspace: comment.workspaceId,
      project: comment.projectId,
      actor: comment.actorId,
      comment_html: comment.commentHtml ?? "",
      comment_stripped: comment.commentStripped ?? "",
      access: comment.access ?? "INTERNAL",
      edited_at: null,
      created_by: comment.createdById,
      updated_by: comment.updatedById,
      created_at: comment.createdAt?.toISOString() ?? null,
      updated_at: comment.updatedAt?.toISOString() ?? null,
      actor_detail: { id: user.id, display_name: user.name },
      comment_reactions: [],
    },
    201
  );
});

// PATCH /:issueId/comments/:commentId/
app.patch("/api/workspaces/:slug/projects/:projectId/issues/:issueId/comments/:commentId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const commentId = c.req.param("commentId");
  const issueId = c.req.param("issueId");

  const comment = await db.query.issueComments.findFirst({
    where: and(eq(issueSchema.issueComments.id, commentId), eq(issueSchema.issueComments.issueId, issueId)),
  });

  if (!comment) return c.json({ detail: "Comment not found." }, 404);

  // Permission check: only creator can edit (simplified — real code also checks admin)
  if (comment.actorId !== user.id && comment.createdById !== user.id) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  const body = await c.req.json();
  const updateData: Record<string, unknown> = { updatedAt: new Date(), updatedById: user.id };

  if (body.comment_html !== undefined) updateData.commentHtml = body.comment_html;
  if (body.comment_stripped !== undefined) updateData.commentStripped = body.comment_stripped;
  if (body.access !== undefined) updateData.access = body.access;

  // Track edited_at if content changed
  if (body.comment_html !== undefined && body.comment_html !== comment.commentHtml) {
    updateData.editedAt = new Date();
  }

  await db.update(issueSchema.issueComments).set(updateData).where(eq(issueSchema.issueComments.id, commentId));

  const updated = await db.query.issueComments.findFirst({ where: eq(issueSchema.issueComments.id, commentId) });

  return c.json({
    id: updated!.id,
    issue: updated!.issueId,
    actor: updated!.actorId,
    comment_html: updated!.commentHtml ?? "",
    access: updated!.access ?? "INTERNAL",
    edited_at: updated!.editedAt?.toISOString() ?? null,
    updated_by: updated!.updatedById,
    updated_at: updated!.updatedAt?.toISOString() ?? null,
  });
});

// DELETE /:issueId/comments/:commentId/
app.delete("/api/workspaces/:slug/projects/:projectId/issues/:issueId/comments/:commentId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const commentId = c.req.param("commentId");
  const issueId = c.req.param("issueId");

  const comment = await db.query.issueComments.findFirst({
    where: and(eq(issueSchema.issueComments.id, commentId), eq(issueSchema.issueComments.issueId, issueId)),
  });

  if (!comment) return c.json({ detail: "Comment not found." }, 404);

  // Permission check
  if (comment.actorId !== user.id && comment.createdById !== user.id) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  await db.delete(issueSchema.issueComments).where(eq(issueSchema.issueComments.id, commentId));

  // Record activity
  await db.insert(issueSchema.issueActivities).values({
    issueId,
    projectId: project.id,
    workspaceId: workspace.id,
    actorId: user.id,
    field: "comment",
    verb: "deleted",
    oldValue: commentId,
    epochTimestamp: Math.floor(Date.now() / 1000),
  });

  return new Response(null, { status: 204 });
});

// --- Comment Reactions (project-level) ---

// GET /:projectId/comments/:commentId/reactions/
app.get("/api/workspaces/:slug/projects/:projectId/comments/:commentId/reactions/", async (c) => {
  const commentId = c.req.param("commentId");

  const reactions = await db
    .select()
    .from(issueSchema.commentReactions)
    .where(eq(issueSchema.commentReactions.commentId, commentId))
    .orderBy(desc(issueSchema.commentReactions.createdAt));

  const actorIds = [...new Set(reactions.map((r) => r.actorId))];
  const actorRows =
    actorIds.length > 0
      ? await db.select().from(userSchema.users).where(inArray(userSchema.users.id, actorIds))
      : [];
  const actorMap = new Map(actorRows.map((a) => [a.id, a]));

  return c.json(
    reactions.map((r) => {
      const actor = actorMap.get(r.actorId);
      return {
        id: r.id,
        comment: r.commentId,
        actor: r.actorId,
        reaction: r.reaction,
        created_at: r.createdAt?.toISOString() ?? null,
        actor_detail: actor
          ? { id: actor.id, display_name: actor.displayName ?? actor.name ?? "" }
          : null,
      };
    })
  );
});

// POST /:projectId/comments/:commentId/reactions/
app.post("/api/workspaces/:slug/projects/:projectId/comments/:commentId/reactions/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const commentId = c.req.param("commentId");
  const body = await c.req.json();

  const existing = await db.query.commentReactions.findFirst({
    where: and(
      eq(issueSchema.commentReactions.commentId, commentId),
      eq(issueSchema.commentReactions.actorId, user.id),
      eq(issueSchema.commentReactions.reaction, body.reaction)
    ),
  });

  if (existing) {
    return c.json({ id: existing.id, comment: existing.commentId, actor: existing.actorId, reaction: existing.reaction });
  }

  const [result] = await db
    .insert(issueSchema.commentReactions)
    .values({ commentId, actorId: user.id, reaction: body.reaction })
    .returning();

  return c.json({ id: result.id, comment: result.commentId, actor: result.actorId, reaction: result.reaction }, 201);
});

// DELETE /:projectId/comments/:commentId/reactions/:reactionCode/
app.delete("/api/workspaces/:slug/projects/:projectId/comments/:commentId/reactions/:reactionCode/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const commentId = c.req.param("commentId");
  const reactionCode = c.req.param("reactionCode");

  const reaction = await db.query.commentReactions.findFirst({
    where: and(
      eq(issueSchema.commentReactions.commentId, commentId),
      eq(issueSchema.commentReactions.reaction, reactionCode),
      eq(issueSchema.commentReactions.actorId, user.id)
    ),
  });

  if (!reaction) return c.json({ detail: "Reaction not found." }, 404);

  await db.delete(issueSchema.commentReactions).where(eq(issueSchema.commentReactions.id, reaction.id));

  return new Response(null, { status: 204 });
});

// --- Setup ---

beforeAll(async () => {
  testUser = { id: createId(), email: "test@example.com", name: "Test User" };
  otherUser = { id: createId(), email: "other@example.com", name: "Other User" };

  await db.insert(userSchema.users).values([
    { id: testUser.id, email: testUser.email, name: testUser.name, displayName: "Test User" },
    { id: otherUser.id, email: otherUser.email, name: otherUser.name, displayName: "Other User" },
  ]);

  workspace = { id: createId(), slug: "test-workspace", name: "Test Workspace" };
  await db.insert(workspaceSchema.workspaces).values({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    ownerId: testUser.id,
  });

  project = { id: createId(), name: "Test Project", identifier: "TEST" };
  await db.insert(projectSchema.projects).values({
    id: project.id,
    workspaceId: workspace.id,
    name: project.name,
    identifier: project.identifier,
  });

  // Add testUser as project member
  await db.insert(projectSchema.projectMembers).values({
    id: createId(),
    projectId: project.id,
    memberId: testUser.id,
    role: 15,
  });

  // Create test issue
  const [issue] = await db
    .insert(issueSchema.issues)
    .values({
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Test Issue for Comments",
      sequenceId: 1,
      createdById: testUser.id,
    })
    .returning();
  testIssue = issue;
});

const issueCommentsUrl = () =>
  `/api/workspaces/${workspace.slug}/projects/${project.id}/issues/${testIssue.id}/comments`;
const projectCommentsUrl = () =>
  `/api/workspaces/${workspace.slug}/projects/${project.id}/comments`;

// =====================================================
// Tests
// =====================================================

describe("Issue Comments CRUD", () => {
  let createdCommentId: string;

  test("lists comments (empty)", async () => {
    const res = await app.request(`${issueCommentsUrl()}/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("creates a comment", async () => {
    const res = await app.request(`${issueCommentsUrl()}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({
        comment_html: "<p>Hello world</p>",
        comment_stripped: "Hello world",
        access: "INTERNAL",
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.comment_html).toBe("<p>Hello world</p>");
    expect(data.comment_stripped).toBe("Hello world");
    expect(data.access).toBe("INTERNAL");
    expect(data.actor).toBe(testUser.id);
    expect(data.issue).toBe(testIssue.id);
    expect(data.workspace).toBe(workspace.id);
    expect(data.project).toBe(project.id);
    expect(data.created_by).toBe(testUser.id);
    expect(data.updated_by).toBe(testUser.id);
    expect(data.actor_detail).not.toBeNull();
    expect(data.actor_detail.id).toBe(testUser.id);
    expect(data.actor_detail.display_name).toBe("Test User");
    expect(data.comment_reactions).toEqual([]);
    expect(data.edited_at).toBeNull();
    createdCommentId = data.id;
  });

  test("creates a comment with EXTERNAL access", async () => {
    const res = await app.request(`${issueCommentsUrl()}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({
        comment_html: "<p>External comment</p>",
        access: "EXTERNAL",
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.access).toBe("EXTERNAL");
  });

  test("lists comments after creation", async () => {
    const res = await app.request(`${issueCommentsUrl()}/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(2);
    // Verify first comment has actor_detail
    const first = data[0];
    expect(first.actor_detail).not.toBeNull();
    expect(first.actor_detail.display_name).toBe("Test User");
    expect(first.workspace_detail.id).toBe(workspace.id);
    expect(first.workspace_detail.slug).toBe(workspace.slug);
    expect(first.project_detail.id).toBe(project.id);
    expect(first.project_detail.identifier).toBe("TEST");
  });

  test("retrieves a single comment", async () => {
    const res = await app.request(`${issueCommentsUrl()}/${createdCommentId}/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(createdCommentId);
    expect(data.comment_html).toBe("<p>Hello world</p>");
    expect(data.actor_detail).not.toBeNull();
  });

  test("returns 404 for non-existent comment", async () => {
    const res = await app.request(`${issueCommentsUrl()}/nonexistent/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(404);
  });

  test("updates a comment", async () => {
    const res = await app.request(`${issueCommentsUrl()}/${createdCommentId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({
        comment_html: "<p>Updated content</p>",
        comment_stripped: "Updated content",
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comment_html).toBe("<p>Updated content</p>");
    expect(data.updated_by).toBe(testUser.id);
    // edited_at should be set since content changed
    expect(data.edited_at).not.toBeNull();
  });

  test("does not set edited_at when content unchanged", async () => {
    // First get current state
    const getRes = await app.request(`${issueCommentsUrl()}/${createdCommentId}/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    const current = await getRes.json();
    const previousEditedAt = current.edited_at;

    // Update with same content
    const res = await app.request(`${issueCommentsUrl()}/${createdCommentId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({
        comment_html: "<p>Updated content</p>", // same as before
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // edited_at should remain the same (not updated again)
    expect(data.edited_at).toBe(previousEditedAt);
  });

  test("prevents other user from editing comment", async () => {
    const res = await app.request(`${issueCommentsUrl()}/${createdCommentId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-user-id": otherUser.id },
      body: JSON.stringify({ comment_html: "<p>Hijack!</p>" }),
    });
    expect(res.status).toBe(403);
  });

  test("prevents other user from deleting comment", async () => {
    const res = await app.request(`${issueCommentsUrl()}/${createdCommentId}/`, {
      method: "DELETE",
      headers: { "x-test-user-id": otherUser.id },
    });
    expect(res.status).toBe(403);
  });

  test("deletes a comment", async () => {
    const res = await app.request(`${issueCommentsUrl()}/${createdCommentId}/`, {
      method: "DELETE",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(204);
  });

  test("returns 404 after deleting comment", async () => {
    const res = await app.request(`${issueCommentsUrl()}/${createdCommentId}/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(404);
  });

  test("records activity on create and delete", async () => {
    const activities = await db.query.issueActivities.findMany({
      where: and(
        eq(issueSchema.issueActivities.issueId, testIssue.id),
        eq(issueSchema.issueActivities.field, "comment")
      ),
    });
    // Should have at least one "created" and one "deleted"
    const created = activities.filter((a) => a.verb === "created");
    const deleted = activities.filter((a) => a.verb === "deleted");
    expect(created.length).toBeGreaterThanOrEqual(1);
    expect(deleted.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Comment Reactions (project-level)", () => {
  let commentId: string;

  beforeAll(async () => {
    // Create a comment for reaction tests
    const [comment] = await db
      .insert(issueSchema.issueComments)
      .values({
        issueId: testIssue.id,
        projectId: project.id,
        workspaceId: workspace.id,
        actorId: testUser.id,
        commentHtml: "<p>Comment for reactions</p>",
        createdById: testUser.id,
        updatedById: testUser.id,
      })
      .returning();
    commentId = comment.id;
  });

  test("lists reactions (empty)", async () => {
    const res = await app.request(`${projectCommentsUrl()}/${commentId}/reactions/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("adds a reaction", async () => {
    const res = await app.request(`${projectCommentsUrl()}/${commentId}/reactions/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ reaction: "128077" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.reaction).toBe("128077");
    expect(data.actor).toBe(testUser.id);
    expect(data.comment).toBe(commentId);
  });

  test("returns existing reaction on duplicate", async () => {
    const res = await app.request(`${projectCommentsUrl()}/${commentId}/reactions/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ reaction: "128077" }),
    });
    expect(res.status).toBe(200); // Not 201
    const data = await res.json();
    expect(data.reaction).toBe("128077");
  });

  test("another user adds different reaction", async () => {
    const res = await app.request(`${projectCommentsUrl()}/${commentId}/reactions/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": otherUser.id },
      body: JSON.stringify({ reaction: "128078" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.reaction).toBe("128078");
    expect(data.actor).toBe(otherUser.id);
  });

  test("lists reactions with actor details", async () => {
    const res = await app.request(`${projectCommentsUrl()}/${commentId}/reactions/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(2);
    // Each reaction should have actor_detail
    for (const r of data) {
      expect(r.actor_detail).not.toBeNull();
      expect(r.actor_detail.id).toBeTruthy();
      expect(r.actor_detail.display_name).toBeTruthy();
    }
  });

  test("reactions appear in comment list response", async () => {
    const res = await app.request(`${issueCommentsUrl()}/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // Find the comment with reactions
    const commentWithReactions = data.find((c: any) => c.id === commentId);
    expect(commentWithReactions).toBeTruthy();
    expect(commentWithReactions.comment_reactions.length).toBe(2);
  });

  test("removes a reaction by code", async () => {
    const res = await app.request(`${projectCommentsUrl()}/${commentId}/reactions/128077/`, {
      method: "DELETE",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(204);
  });

  test("returns 404 when removing non-existent reaction", async () => {
    const res = await app.request(`${projectCommentsUrl()}/${commentId}/reactions/128077/`, {
      method: "DELETE",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(404);
  });

  test("reaction count decreases after removal", async () => {
    const res = await app.request(`${projectCommentsUrl()}/${commentId}/reactions/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].reaction).toBe("128078");
    expect(data[0].actor).toBe(otherUser.id);
  });
});

describe("Comment edge cases", () => {
  test("requires authentication", async () => {
    const res = await app.request(`${issueCommentsUrl()}/`, {
      // No x-test-user-id header
    });
    expect(res.status).toBe(401);
  });

  test("creating comment with JSON content", async () => {
    const commentJson = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    };
    const res = await app.request(`${issueCommentsUrl()}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({
        comment_html: "<p>Hello</p>",
        comment_json: commentJson,
      }),
    });
    expect(res.status).toBe(201);
  });

  test("update comment access level", async () => {
    // Create then update
    const createRes = await app.request(`${issueCommentsUrl()}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ comment_html: "<p>Private</p>", access: "INTERNAL" }),
    });
    const created = await createRes.json();

    const updateRes = await app.request(`${issueCommentsUrl()}/${created.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ access: "EXTERNAL" }),
    });
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.access).toBe("EXTERNAL");
  });
});
