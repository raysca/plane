import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { deleteCookie } from "hono/cookie";
import { auth } from "../../lib/auth";
import { csrfTokenMiddleware, getCsrfToken } from "../../middleware/csrf";

const authRoutes = new Hono();

// Apply CSRF token middleware to all auth routes
authRoutes.use("*", csrfTokenMiddleware);

// Validation schemas
const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

const magicLinkSchema = z.object({
  email: z.string().email(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const setPasswordSchema = z.object({
  password: z.string().min(8).max(128),
  confirm_password: z.string().min(8).max(128),
  token: z.string().optional(),
  uid: z.string().optional(),
});

// Helper to format user response in DRF format
function formatUserResponse(user: Record<string, unknown>) {
  return {
    id: user.id,
    email: user.email,
    first_name: (user.firstName as string) || "",
    last_name: (user.lastName as string) || "",
    username: (user.username as string) || "",
    display_name: (user.displayName as string) || (user.name as string) || "",
    avatar: (user.avatar as string) || "",
    is_onboarded: (user.isOnboarded as boolean) || false,
    is_active: (user.isActive as boolean) ?? true,
    is_tour_completed: (user.isTourCompleted as boolean) || false,
    onboarding_step: (user.onboardingStep as number) || 0,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  };
}

// CSRF token endpoint (frontend expects this)
authRoutes.get("/get-csrf-token/", (c) => {
  const csrfToken = getCsrfToken(c);
  return c.json({
    csrf_token: csrfToken,
  });
});

// Sign in with email/password
authRoutes.post("/sign-in/", zValidator("json", signInSchema), async (c) => {
  const { email, password } = c.req.valid("json");

  try {
    const result = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });

    // Get cookies from Better Auth response and forward them
    const setCookieHeaders = result.headers.getSetCookie();
    for (const cookie of setCookieHeaders) {
      c.header("Set-Cookie", cookie, { append: true });
    }

    if (!result.ok) {
      const data = (await result.json()) as { message?: string };
      return c.json(
        { detail: data.message || "Invalid email or password." },
        401
      );
    }

    const data = (await result.json()) as { user: Record<string, unknown>; token?: string };

    // Return user data in DRF format
    return c.json({
      user: formatUserResponse(data.user),
      access_token: data.token,
    });
  } catch (error) {
    console.error("[Auth] Sign in error:", error);
    return c.json({ detail: "Invalid email or password." }, 401);
  }
});

// Sign up
authRoutes.post("/sign-up/", zValidator("json", signUpSchema), async (c) => {
  const { email, password, first_name, last_name } = c.req.valid("json");

  try {
    const name = [first_name, last_name].filter(Boolean).join(" ");
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: name || "User",
      },
      asResponse: true,
    });

    // Forward cookies
    const setCookieHeaders = result.headers.getSetCookie();
    for (const cookie of setCookieHeaders) {
      c.header("Set-Cookie", cookie, { append: true });
    }

    if (!result.ok) {
      const data = (await result.json()) as { message?: string };
      // Handle specific errors
      if (data.message?.includes("already exists")) {
        return c.json({ email: ["A user with this email already exists."] }, 400);
      }
      return c.json({ detail: data.message || "Failed to create account." }, 400);
    }

    const data = (await result.json()) as { user: Record<string, unknown>; token?: string };

    return c.json({
      user: formatUserResponse(data.user),
      access_token: data.token,
    });
  } catch (error) {
    console.error("[Auth] Sign up error:", error);
    return c.json({ detail: "Failed to create account." }, 400);
  }
});

// Sign out
authRoutes.post("/sign-out/", async (c) => {
  try {
    await auth.api.signOut({
      headers: c.req.raw.headers,
      asResponse: true,
    });

    // Clear session cookies
    deleteCookie(c, "plane.session_token");
    deleteCookie(c, "plane.session_data");

    return c.json({ detail: "Successfully logged out." });
  } catch (error) {
    console.error("[Auth] Sign out error:", error);
    // Even if there's an error, clear cookies
    deleteCookie(c, "plane.session_token");
    deleteCookie(c, "plane.session_data");
    return c.json({ detail: "Successfully logged out." });
  }
});

// Magic link - generate code
authRoutes.post("/magic-generate/", zValidator("json", magicLinkSchema), async (c) => {
  const { email } = c.req.valid("json");

  try {
    const result = await auth.api.signInMagicLink({
      body: { email },
      headers: c.req.raw.headers,
      asResponse: true,
    });

    if (!result.ok) {
      const data = (await result.json()) as { message?: string };
      return c.json({ detail: data.message || "Failed to send magic link." }, 400);
    }

    return c.json({
      detail: "Magic link sent to your email.",
      email,
    });
  } catch (error) {
    console.error("[Auth] Magic link generate error:", error);
    return c.json({ detail: "Failed to send magic link." }, 400);
  }
});

// Magic link - verify and sign in
authRoutes.post("/magic-sign-in/", async (c) => {
  const body = (await c.req.json()) as { token?: string; key?: string };
  const { token, key } = body;

  // Support both token (from URL) and key (from code entry)
  const magicToken = token || key;

  if (!magicToken) {
    return c.json({ detail: "Token is required." }, 400);
  }

  try {
    // Magic link verify uses query params, not body
    const result = await auth.api.magicLinkVerify({
      query: { token: magicToken },
      headers: c.req.raw.headers,
      asResponse: true,
    });

    // Forward cookies
    const setCookieHeaders = result.headers.getSetCookie();
    for (const cookie of setCookieHeaders) {
      c.header("Set-Cookie", cookie, { append: true });
    }

    if (!result.ok) {
      const data = (await result.json()) as { message?: string };
      return c.json(
        { detail: data.message || "Invalid or expired magic link." },
        400
      );
    }

    const data = (await result.json()) as { user: Record<string, unknown>; token?: string };

    return c.json({
      user: formatUserResponse(data.user),
      access_token: data.token,
    });
  } catch (error) {
    console.error("[Auth] Magic sign in error:", error);
    return c.json({ detail: "Invalid or expired magic link." }, 400);
  }
});

// Forgot password
authRoutes.post("/forgot-password/", zValidator("json", forgotPasswordSchema), async (c) => {
  const { email } = c.req.valid("json");

  try {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: `${process.env.FRONTEND_URL}/reset-password` },
      asResponse: true,
    });

    // Always return success to prevent email enumeration
    return c.json({
      detail: "If an account exists with this email, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("[Auth] Forgot password error:", error);
    // Still return success to prevent email enumeration
    return c.json({
      detail: "If an account exists with this email, a password reset link has been sent.",
    });
  }
});

// Set password (reset)
authRoutes.post("/set-password/", zValidator("json", setPasswordSchema), async (c) => {
  const { password, confirm_password, token } = c.req.valid("json");

  if (password !== confirm_password) {
    return c.json({ confirm_password: ["Passwords do not match."] }, 400);
  }

  if (!token) {
    return c.json({ detail: "Reset token is required." }, 400);
  }

  try {
    const result = await auth.api.resetPassword({
      body: { token, newPassword: password },
      asResponse: true,
    });

    if (!result.ok) {
      const data = (await result.json()) as { message?: string };
      return c.json(
        { detail: data.message || "Failed to reset password. Token may be invalid or expired." },
        400
      );
    }

    return c.json({ detail: "Password has been reset successfully." });
  } catch (error) {
    console.error("[Auth] Set password error:", error);
    return c.json({ detail: "Failed to reset password." }, 400);
  }
});

// Change password (authenticated)
authRoutes.post("/change-password/", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const body = (await c.req.json()) as {
    old_password?: string;
    new_password?: string;
    confirm_password?: string;
  };
  const { old_password, new_password, confirm_password } = body;

  if (!old_password || !new_password) {
    return c.json({ detail: "Old password and new password are required." }, 400);
  }

  if (new_password !== confirm_password) {
    return c.json({ confirm_password: ["Passwords do not match."] }, 400);
  }

  try {
    const result = await auth.api.changePassword({
      body: {
        currentPassword: old_password,
        newPassword: new_password,
      },
      headers: c.req.raw.headers,
      asResponse: true,
    });

    if (!result.ok) {
      const data = (await result.json()) as { message?: string };
      return c.json(
        { detail: data.message || "Failed to change password." },
        400
      );
    }

    return c.json({ detail: "Password changed successfully." });
  } catch (error) {
    console.error("[Auth] Change password error:", error);
    return c.json({ detail: "Failed to change password." }, 400);
  }
});

// OAuth redirect routes - these redirect to Better Auth OAuth handlers
authRoutes.get("/google/", (c) => {
  const callbackUrl = `${process.env.FRONTEND_URL}/`;
  return c.redirect(
    `/api/auth/sign-in/social?provider=google&callbackURL=${encodeURIComponent(callbackUrl)}`
  );
});

authRoutes.get("/github/", (c) => {
  const callbackUrl = `${process.env.FRONTEND_URL}/`;
  return c.redirect(
    `/api/auth/sign-in/social?provider=github&callbackURL=${encodeURIComponent(callbackUrl)}`
  );
});

authRoutes.get("/gitlab/", (c) => {
  const callbackUrl = `${process.env.FRONTEND_URL}/`;
  return c.redirect(
    `/api/auth/sign-in/social?provider=gitlab&callbackURL=${encodeURIComponent(callbackUrl)}`
  );
});

authRoutes.get("/gitea/", (c) => {
  const callbackUrl = `${process.env.FRONTEND_URL}/`;
  return c.redirect(
    `/api/auth/oauth2/authorize/gitea?callbackURL=${encodeURIComponent(callbackUrl)}`
  );
});

// Get current user (session check)
authRoutes.get("/me/", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ detail: "Not authenticated." }, 401);
  }

  return c.json(formatUserResponse(session.user as Record<string, unknown>));
});

export { authRoutes };
