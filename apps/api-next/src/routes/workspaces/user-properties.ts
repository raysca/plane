import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { workspaces, workspaceUserProperties } from "../../db/schema/workspace";
import { authMiddleware } from "../../middleware/auth";
import type { Variables } from "../../app";

const userPropertiesRoutes = new Hono<{ Variables: Variables }>();

userPropertiesRoutes.use("*", authMiddleware);

const updateUserPropertiesSchema = z.object({
    filters: z.record(z.string(), z.any()).optional(),
    display_filters: z.record(z.string(), z.any()).optional(),
    display_properties: z.record(z.string(), z.any()).optional(),
    rich_filters: z.record(z.string(), z.any()).optional(),
    navigation_project_limit: z.number().int().optional(),
    navigation_control_preference: z.enum(["ACCORDION", "TABBED"]).optional(),
    product_tour: z.record(z.string(), z.any()).optional(),
});

// GET /api/workspaces/:slug/user-properties/
userPropertiesRoutes.get("/", async (c) => {
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

    // Find or create properties
    let properties = await db.query.workspaceUserProperties.findFirst({
        where: and(
            eq(workspaceUserProperties.workspaceId, workspace.id),
            eq(workspaceUserProperties.userId, contextUser.id)
        ),
    });

    if (!properties) {
        const result = await db.insert(workspaceUserProperties).values({
            workspaceId: workspace.id,
            userId: contextUser.id,
            // defaults are handled by the schema
        }).returning();
        properties = result[0];
    }

    return c.json({
        id: properties!.id,
        workspace: properties!.workspaceId,
        user: properties!.userId,
        filters: properties!.filters ?? {},
        display_filters: properties!.displayFilters ?? {},
        display_properties: properties!.displayProperties ?? {},
        rich_filters: properties!.richFilters ?? {},
        navigation_project_limit: properties!.navigationProjectLimit ?? 10,
        navigation_control_preference: properties!.navigationControlPreference ?? "ACCORDION",
        product_tour: properties!.productTour ?? {},
        created_at: properties!.createdAt,
        updated_at: properties!.updatedAt,
    });
});

// PATCH /api/workspaces/:slug/user-properties/
userPropertiesRoutes.patch("/", zValidator("json", updateUserPropertiesSchema), async (c) => {
    const contextUser = c.get("user");
    const slug = c.req.param("slug");
    const body = c.req.valid("json");

    if (!contextUser) return c.json({ detail: "Authentication required" }, 401);
    if (!slug) return c.json({ detail: "Workspace not found" }, 404);

    const workspace = await db.query.workspaces.findFirst({
        where: eq(workspaces.slug, slug),
    });

    if (!workspace) {
        return c.json({ detail: "Workspace not found" }, 404);
    }

    // Find or create properties
    let properties = await db.query.workspaceUserProperties.findFirst({
        where: and(
            eq(workspaceUserProperties.workspaceId, workspace.id),
            eq(workspaceUserProperties.userId, contextUser.id)
        ),
    });

    if (!properties) {
        const result = await db.insert(workspaceUserProperties).values({
            workspaceId: workspace.id,
            userId: contextUser.id,
        }).returning();
        properties = result[0];
    }

    const updateData: any = {
        updatedAt: new Date(),
    };

    if (body.filters !== undefined) updateData.filters = body.filters;
    if (body.display_filters !== undefined) updateData.displayFilters = body.display_filters;
    if (body.display_properties !== undefined) updateData.displayProperties = body.display_properties;
    if (body.rich_filters !== undefined) updateData.richFilters = body.rich_filters;
    if (body.navigation_project_limit !== undefined) updateData.navigationProjectLimit = body.navigation_project_limit;
    if (body.navigation_control_preference !== undefined) updateData.navigationControlPreference = body.navigation_control_preference;
    if (body.product_tour !== undefined) updateData.productTour = body.product_tour;

    await db.update(workspaceUserProperties)
        .set(updateData)
        .where(eq(workspaceUserProperties.id, properties!.id));

    const updatedProperties = await db.query.workspaceUserProperties.findFirst({
        where: eq(workspaceUserProperties.id, properties!.id),
    });

    return c.json({
        id: updatedProperties!.id,
        workspace: updatedProperties!.workspaceId,
        user: updatedProperties!.userId,
        filters: updatedProperties!.filters ?? {},
        display_filters: updatedProperties!.displayFilters ?? {},
        display_properties: updatedProperties!.displayProperties ?? {},
        rich_filters: updatedProperties!.richFilters ?? {},
        navigation_project_limit: updatedProperties!.navigationProjectLimit ?? 10,
        navigation_control_preference: updatedProperties!.navigationControlPreference ?? "ACCORDION",
        product_tour: updatedProperties!.productTour ?? {},
        created_at: updatedProperties!.createdAt,
        updated_at: updatedProperties!.updatedAt,
    });
});

export default userPropertiesRoutes;
