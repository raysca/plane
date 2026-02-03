import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { workspaces } from "../db/schema/workspace";
import { RESTRICTED_WORKSPACE_SLUGS } from "../lib/constants";
import type { Variables } from "../app";

const workspaceSlugCheckRoutes = new Hono<{ Variables: Variables }>();

const slugCheckSchema = z.object({
    slug: z.string().min(1),
});

workspaceSlugCheckRoutes.get("/", zValidator("query", slugCheckSchema), async (c) => {
    const { slug } = c.req.valid("query");

    // Check if slug is restricted
    if (RESTRICTED_WORKSPACE_SLUGS.includes(slug)) {
        return c.json({ status: false });
    }

    // Check if slug exists in database
    const existing = await db.query.workspaces.findFirst({
        where: eq(workspaces.slug, slug),
    });

    return c.json({ status: !existing });
});

export { workspaceSlugCheckRoutes };
