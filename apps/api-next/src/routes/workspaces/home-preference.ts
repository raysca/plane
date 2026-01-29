import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db";
import { workspaceHomePreferences, workspaces } from "../../db/schema/workspace";
import { users } from "../../db/schema/user";
import { authMiddleware } from "../../middleware/auth";
import type { Variables } from "../../app";

const homePreferenceRoutes = new Hono<{ Variables: Variables }>();

homePreferenceRoutes.use("*", authMiddleware);

const WIDGET_KEYS = ["quick_links", "recents", "my_stickies", "new_at_plane", "quick_tutorial"];
const AUTO_CREATE_KEYS = ["quick_links", "recents", "my_stickies"]; // Exclude new_at_plane, quick_tutorial

const updatePreferenceSchema = z.object({
    is_enabled: z.boolean().optional(),
    config: z.record(z.any()).optional(),
    sort_order: z.number().optional(),
});

// GET /api/workspaces/:slug/home-preferences/
homePreferenceRoutes.get("/", async (c) => {
    const contextUser = c.get("user");
    const slug = c.req.param("slug");

    if (!contextUser) return c.json({ detail: "Authentication required" }, 401);
    if (!slug) return c.json({ detail: "Workspace not found" }, 404);

    const workspace = await db.query.workspaces.findFirst({
        where: eq(workspaces.slug, slug),
    });

    if (!workspace) {
        return c.json({ detail: "Workspace not found" }, 404);
    }

    // Find existing preferences
    const existingPrefs = await db.query.workspaceHomePreferences.findMany({
        where: and(
            eq(workspaceHomePreferences.workspaceId, workspace.id),
            eq(workspaceHomePreferences.userId, contextUser.id)
        ),
    });

    const existingKeys = existingPrefs.map((p) => p.key);
    const missingKeys = AUTO_CREATE_KEYS.filter((key) => !existingKeys.includes(key));

    if (missingKeys.length > 0) {
        let sortOrderCounter = 1;
        const toCreate = missingKeys.map((key) => ({
            workspaceId: workspace.id,
            userId: contextUser.id,
            key,
            sortOrder: 1000 - sortOrderCounter++,
        }));

        await db.insert(workspaceHomePreferences).values(toCreate);
    }

    // Re-fetch all preferences
    const allPrefs = await db.query.workspaceHomePreferences.findMany({
        where: and(
            eq(workspaceHomePreferences.workspaceId, workspace.id),
            eq(workspaceHomePreferences.userId, contextUser.id)
        ),
    });

    return c.json(
        allPrefs.map((p) => ({
            key: p.key,
            is_enabled: p.isEnabled ?? true,
            config: p.config ?? {},
            sort_order: p.sortOrder ?? 65535,
        }))
    );
});

// PATCH /api/workspaces/:slug/home-preferences/:key/
homePreferenceRoutes.patch("/:key/", zValidator("json", updatePreferenceSchema), async (c) => {
    const contextUser = c.get("user");
    const slug = c.req.param("slug");
    const key = c.req.param("key");
    const body = c.req.valid("json");

    if (!contextUser) return c.json({ detail: "Authentication required" }, 401);
    if (!slug) return c.json({ detail: "Workspace not found" }, 404);

    const workspace = await db.query.workspaces.findFirst({
        where: eq(workspaces.slug, slug),
    });

    if (!workspace) {
        return c.json({ detail: "Workspace not found" }, 404);
    }

    const preference = await db.query.workspaceHomePreferences.findFirst({
        where: and(
            eq(workspaceHomePreferences.workspaceId, workspace.id),
            eq(workspaceHomePreferences.userId, contextUser.id),
            eq(workspaceHomePreferences.key, key)
        ),
    });

    if (!preference) {
        return c.json({ detail: "Preference not found" }, 404);
    }

    const updateData: any = {
        updatedAt: new Date(),
    };

    if (body.is_enabled !== undefined) updateData.isEnabled = body.is_enabled;
    if (body.config !== undefined) updateData.config = body.config;
    if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

    await db.update(workspaceHomePreferences)
        .set(updateData)
        .where(eq(workspaceHomePreferences.id, preference.id));

    const updatedPreference = await db.query.workspaceHomePreferences.findFirst({
        where: eq(workspaceHomePreferences.id, preference.id),
    });

    return c.json({
        key: updatedPreference!.key,
        is_enabled: updatedPreference!.isEnabled ?? true,
        config: updatedPreference!.config ?? {},
        sort_order: updatedPreference!.sortOrder ?? 65535,
    }, 200);
});

export default homePreferenceRoutes;
