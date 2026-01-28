import { Hono } from "hono";

const userRoutes = new Hono();

// Current user endpoints
userRoutes.get("/me/", async (c) => {
  // TODO: Get current user from Better Auth session
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.patch("/me/", async (c) => {
  // TODO: Update current user
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.get("/me/profile/", async (c) => {
  // TODO: Get user profile
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.patch("/me/profile/", async (c) => {
  // TODO: Update user profile
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.get("/me/settings/", async (c) => {
  // TODO: Get user settings
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.patch("/me/settings/", async (c) => {
  // TODO: Update user settings
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.get("/me/accounts/", async (c) => {
  // TODO: Get linked OAuth accounts
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.get("/me/workspaces/", async (c) => {
  // TODO: Get user's workspaces
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.get("/me/activities/", async (c) => {
  // TODO: Get user activities
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.get("/me/notification-preferences/", async (c) => {
  // TODO: Get notification preferences
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.patch("/me/notification-preferences/", async (c) => {
  // TODO: Update notification preferences
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.get("/me/instance-admin/", async (c) => {
  // TODO: Check if user is instance admin
  return c.json({ is_admin: false });
});

userRoutes.get("/last-visited-workspace/", async (c) => {
  // TODO: Get last visited workspace
  return c.json({ detail: "Not implemented" }, 501);
});

// Email management
userRoutes.get("/me/email/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.post("/me/email/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.delete("/me/email/:emailId/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

userRoutes.post("/me/email/:emailId/set-primary/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

export { userRoutes };
