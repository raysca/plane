import { Hono } from "hono";

const authRoutes = new Hono();

// CSRF token endpoint (frontend expects this)
authRoutes.get("/get-csrf-token/", (c) => {
  // Generate a simple CSRF token
  // In production, this should be stored in session
  const csrfToken = crypto.randomUUID();

  return c.json({
    csrf_token: csrfToken,
  });
});

// Sign in with email/password
authRoutes.post("/sign-in/", async (c) => {
  // TODO: Implement with Better Auth
  return c.json({ detail: "Not implemented" }, 501);
});

// Sign up
authRoutes.post("/sign-up/", async (c) => {
  // TODO: Implement with Better Auth
  return c.json({ detail: "Not implemented" }, 501);
});

// Sign out
authRoutes.post("/sign-out/", async (c) => {
  // TODO: Implement with Better Auth
  return c.json({ detail: "Not implemented" }, 501);
});

// Magic link - generate code
authRoutes.post("/magic-generate/", async (c) => {
  // TODO: Implement with Better Auth magic link plugin
  return c.json({ detail: "Not implemented" }, 501);
});

// Magic link - sign in
authRoutes.post("/magic-sign-in/", async (c) => {
  // TODO: Implement with Better Auth magic link plugin
  return c.json({ detail: "Not implemented" }, 501);
});

// Forgot password
authRoutes.post("/forgot-password/", async (c) => {
  // TODO: Implement with Better Auth
  return c.json({ detail: "Not implemented" }, 501);
});

// Set password
authRoutes.post("/set-password/", async (c) => {
  // TODO: Implement with Better Auth
  return c.json({ detail: "Not implemented" }, 501);
});

// OAuth routes
authRoutes.get("/google/", (c) => {
  // TODO: Redirect to Google OAuth
  return c.redirect("/api/auth/sign-in/social?provider=google");
});

authRoutes.get("/github/", (c) => {
  // TODO: Redirect to GitHub OAuth
  return c.redirect("/api/auth/sign-in/social?provider=github");
});

authRoutes.get("/gitlab/", (c) => {
  // TODO: Redirect to GitLab OAuth
  return c.redirect("/api/auth/sign-in/social?provider=gitlab");
});

authRoutes.get("/gitea/", (c) => {
  // TODO: Redirect to Gitea OAuth (generic OAuth)
  return c.redirect("/api/auth/oauth2/callback/gitea");
});

export { authRoutes };
