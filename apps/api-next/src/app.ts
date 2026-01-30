import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import { timing } from "hono/timing";
import { errorHandler } from "./middleware/error";
import { auth } from "./lib/auth";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { workspaceRoutes } from "./routes/workspaces";
import { projectRoutes } from "./routes/projects";
import { issueRoutes } from "./routes/issues";
import { instanceRoutes } from "./routes/instances";
import { workspaceSlugCheckRoutes } from "./routes/workspace-slug-check";
import { externalRoutes } from "./routes/external";
import { assetRoutes } from "./routes/assets";


// Types for context variables
export type Variables = {
  user: {
    id: string;
    email: string;
    name: string | null;
    username: string | null;
    displayName: string | null;
    avatar: string | null;
    isOnboarded: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  } | null;
  workspace: {
    id: string;
    name: string;
    slug: string;
    ownerId: string;
  } | null;
  workspaceMembership: {
    id: string;
    workspaceId: string;
    userId: string;
    role: number;
  } | null;
  project: {
    id: string;
    name: string;
    workspaceId: string;
    identifier: string;
    network: number | null;
  } | null;
  projectMembership: {
    id: string;
    projectId: string;
    memberId: string;
    role: number;
  } | null;
  csrfToken: string;
};

// Create Hono app
const app = new Hono<{ Variables: Variables }>();

// Global middleware
app.use("*", timing());
app.use("*", logger());
app.use("*", prettyJSON());
app.use("*", secureHeaders());

// CORS configuration
app.use(
  "*",
  cors({
    origin: [
      process.env.FRONTEND_URL || "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3001",
      "http://localhost:4000",
    ],
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-CSRFTOKEN"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  })
);

// Error handler
app.onError(errorHandler);

// Health check
app.get("/api/health/", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.1",
  });
});

// Mount Better Auth handler for internal routes (OAuth callbacks, etc.)
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Mount routes
app.route("/auth/", authRoutes);
app.route("/api/instances/", instanceRoutes);
app.route("/api/users/", userRoutes);
app.route("/api/workspaces/", workspaceRoutes);
app.route("/api/workspaces/:slug/projects/", projectRoutes);
app.route("/api/workspaces/:slug/projects/:projectId/issues/", issueRoutes);
app.route("/api/workspace-slug-check/", workspaceSlugCheckRoutes);
app.route("/api/unsplash/", externalRoutes);
app.route("/api/assets/v2/", assetRoutes);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      detail: "Not found.",
    },
    404
  );
});

export { app };
