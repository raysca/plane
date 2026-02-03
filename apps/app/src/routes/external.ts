import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Variables } from "../app";

const externalRoutes = new Hono<{ Variables: Variables }>();

// Apply auth middleware to all external routes
externalRoutes.use("*", authMiddleware);

// GET /api/unsplash/ - Proxy to Unsplash API for image search/browse
externalRoutes.get("/", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

  // Return empty array if key is not configured
  if (!UNSPLASH_ACCESS_KEY) {
    return c.json([], 200);
  }

  const query = c.req.query("query");
  const page = c.req.query("page") || "1";
  const perPage = c.req.query("per_page") || "20";

  // Use search endpoint when query is provided, otherwise browse photos
  const url = query
    ? `https://api.unsplash.com/search/photos/?client_id=${UNSPLASH_ACCESS_KEY}&query=${query}&page=${page}&per_page=${perPage}`
    : `https://api.unsplash.com/photos/?client_id=${UNSPLASH_ACCESS_KEY}&page=${page}&per_page=${perPage}`;

  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });

  const data = await resp.json();
  return c.json(data, resp.status as any);
});

export { externalRoutes };
