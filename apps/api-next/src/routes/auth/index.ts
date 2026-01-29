import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { deleteCookie } from "hono/cookie";
import { auth } from "../../lib/auth";
import { csrfTokenMiddleware, getCsrfToken } from "../../middleware/csrf";
import { eq, and, asc } from "drizzle-orm";
import { db } from "../../db";
import { users, userProfiles } from "../../db/schema/user";
import { workspaces, workspaceMembers, workspaceInvitations } from "../../db/schema/workspace";

const authRoutes = new Hono();

// Apply CSRF token middleware to all auth routes
authRoutes.use("*", csrfTokenMiddleware);

// Validation schemas
const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const signUpSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

const magicLinkSchema = z.object({
  email: z.email(),
});

const forgotPasswordSchema = z.object({
  email: z.email(),
});

const setPasswordSchema = z.object({
  password: z.string().min(8).max(128),
  confirm_password: z.string().min(8).max(128),
  token: z.string().optional(),
  uid: z.string().optional(),
});

const emailCheckSchema = z.object({
  email: z.email(),
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

// Authentication error codes (matching Django's AUTHENTICATION_ERROR_CODES)
const AUTH_ERROR_CODES = {
  INSTANCE_NOT_CONFIGURED: 5000,
  SIGNUP_DISABLED: 5015,
  INVALID_PASSWORD: 5020,
  USER_ALREADY_EXIST: 5030,
  AUTHENTICATION_FAILED_SIGN_UP: 5035,
  REQUIRED_EMAIL_PASSWORD_SIGN_UP: 5040,
  INVALID_EMAIL_SIGN_UP: 5045,
  INVALID_EMAIL_MAGIC_SIGN_UP: 5050,
  MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED: 5055,
  USER_DOES_NOT_EXIST: 5060,
  AUTHENTICATION_FAILED_SIGN_IN: 5065,
  REQUIRED_EMAIL_PASSWORD_SIGN_IN: 5070,
  INVALID_EMAIL_SIGN_IN: 5075,
} as const;

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

/**
 * Build a safe redirect URL with optional error query params
 * Matches Django's get_safe_redirect_url behavior
 */
function buildRedirectUrl(nextPath?: string | null, params?: Record<string, string | number>): string {
  const base = FRONTEND_URL;
  const path = nextPath || "/";
  const url = new URL(path, base);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

/**
 * Get redirection path after login/signup
 * Matches Django's get_redirection_path logic
 */
async function getRedirectionPath(userId: string, email: string): Promise<string> {
  // Check if user is onboarded
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user?.isOnboarded) {
    return "/onboarding";
  }

  // Check for active workspace memberships
  const memberships = await db
    .select({ workspace: workspaces })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.isActive, true)
    ))
    .orderBy(asc(workspaces.createdAt));

  if (memberships.length > 0) {
    return `/${memberships[0]!.workspace.slug}`;
  }

  // Check for pending invitations
  const pendingInvitations = await db.query.workspaceInvitations.findFirst({
    where: eq(workspaceInvitations.email, email),
  });

  if (pendingInvitations) {
    return "/invitations";
  }

  return "/create-workspace";
}

/**
 * Process accepted workspace invitations after signup/login
 * Matches Django's process_workspace_project_invitations
 */
async function processWorkspaceInvitations(userId: string, email: string): Promise<void> {
  // Find accepted workspace invitations for this email
  const acceptedInvites = await db.query.workspaceInvitations.findMany({
    where: and(
      eq(workspaceInvitations.email, email),
      eq(workspaceInvitations.accepted, true)
    ),
  });

  for (const invite of acceptedInvites) {
    // Check if already a member
    const existingMember = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, invite.workspaceId),
        eq(workspaceMembers.userId, userId)
      ),
    });

    if (!existingMember) {
      await db.insert(workspaceMembers).values({
        workspaceId: invite.workspaceId,
        userId: userId,
        role: invite.role,
      });
    }
  }

  // Delete processed invitations
  if (acceptedInvites.length > 0) {
    for (const invite of acceptedInvites) {
      await db.delete(workspaceInvitations).where(eq(workspaceInvitations.id, invite.id));
    }
  }
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Email check
authRoutes.post("/email-check/", zValidator("json", emailCheckSchema), async (c) => {
  const { email } = c.req.valid("json");

  // TODO: Fetch actual instance configuration from DB
  const smtpConfigured = !!process.env.EMAIL_HOST;
  const isMagicLoginEnabled = process.env.ENABLE_MAGIC_LINK_LOGIN === "1";

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (user) {
    return c.json({
      existing: true,
      status: user.isPasswordAutoset && smtpConfigured && isMagicLoginEnabled ? "MAGIC_CODE" : "CREDENTIAL",
    });
  }

  return c.json({
    existing: false,
    status: smtpConfigured && isMagicLoginEnabled ? "MAGIC_CODE" : "CREDENTIAL",
  });
});

// CSRF token endpoint (frontend expects this)
authRoutes.get("/get-csrf-token/", (c) => {
  const csrfToken = getCsrfToken(c);
  return c.json({
    csrf_token: csrfToken,
  });
});

// Sign in with email/password
authRoutes.post("/sign-in/", async (c) => {
  let email, password;
  const contentType = c.req.header("content-type");
  const isJson = contentType?.includes("application/json");

  // Parse body based on content type
  if (isJson) {
    const body = await c.req.json();
    email = body.email;
    password = body.password;
  } else {
    const body = await c.req.parseBody();
    email = body["email"];
    password = body["password"];
  }

  // Validate input
  const parseResult = signInSchema.safeParse({ email, password });
  if (!parseResult.success) {
    if (isJson) {
      return c.json({ detail: "Invalid email or password." }, 400);
    }
    return c.redirect(buildRedirectUrl(null, { error_code: AUTH_ERROR_CODES.REQUIRED_EMAIL_PASSWORD_SIGN_IN }));
  }

  try {
    const result = await auth.api.signInEmail({
      body: { email: email as string, password: password as string },
      asResponse: true,
    });

    // Get cookies from Better Auth response and forward them
    const setCookieHeaders = result.headers.getSetCookie();
    for (const cookie of setCookieHeaders) {
      c.header("Set-Cookie", cookie, { append: true });
    }

    if (!result.ok) {
      const data = (await result.json()) as { message?: string };
      if (isJson) {
        return c.json(
          { detail: data.message || "Invalid email or password." },
          401
        );
      }
      // Map better-auth errors to Plane error codes if possible, or use generic
      // 5065 = AUTHENTICATION_FAILED_SIGN_IN
      // 5060 = USER_DOES_NOT_EXIST
      // 5075 = INVALID_EMAIL_SIGN_IN
      return c.redirect(buildRedirectUrl(null, { error_code: AUTH_ERROR_CODES.AUTHENTICATION_FAILED_SIGN_IN }));
    }

    const data = (await result.json()) as { user: Record<string, unknown>; token?: string };
    const userId = data.user.id as string;
    const userEmail = data.user.email as string;

    // Post-login workflow: process accepted workspace invitations
    await processWorkspaceInvitations(userId, userEmail);

    if (isJson) {
      // Return user data in DRF format
      return c.json({
        user: formatUserResponse(data.user),
        access_token: data.token,
      });
    }

    // Form submission success redirect
    const nextPath = c.req.query("next_path");
    const path = nextPath || await getRedirectionPath(userId, userEmail);
    return c.redirect(buildRedirectUrl(path));

  } catch (error) {
    console.error("[Auth] Sign in error:", error);
    if (isJson) {
      return c.json({ detail: "Invalid email or password." }, 401);
    }
    return c.redirect(buildRedirectUrl(null, { error_code: AUTH_ERROR_CODES.AUTHENTICATION_FAILED_SIGN_IN }));
  }
});

// Sign up - supports both JSON and form POST (matching Django's SignUpAuthEndpoint)
authRoutes.post("/sign-up/", async (c) => {
  let email: string | undefined;
  let password: string | undefined;
  let firstName: string | undefined;
  let lastName: string | undefined;
  let nextPath: string | undefined;

  const contentType = c.req.header("content-type");
  const isJson = contentType?.includes("application/json");

  // Parse body based on content type
  if (isJson) {
    const body = await c.req.json();
    email = body.email;
    password = body.password;
    firstName = body.first_name;
    lastName = body.last_name;
  } else {
    const body = await c.req.parseBody();
    email = body["email"] as string | undefined;
    password = body["password"] as string | undefined;
    firstName = body["first_name"] as string | undefined;
    lastName = body["last_name"] as string | undefined;
    nextPath = body["next_path"] as string | undefined;
  }

  // Validate required fields
  if (!email || !password) {
    if (isJson) {
      return c.json({ detail: "Email and password are required." }, 400);
    }
    return c.redirect(buildRedirectUrl(nextPath, {
      error_code: AUTH_ERROR_CODES.REQUIRED_EMAIL_PASSWORD_SIGN_UP,
      error_message: "REQUIRED_EMAIL_PASSWORD_SIGN_UP",
    }));
  }

  // Normalize email
  email = email.trim().toLowerCase();

  // Validate email format
  if (!isValidEmail(email)) {
    if (isJson) {
      return c.json({ detail: "Invalid email address." }, 400);
    }
    return c.redirect(buildRedirectUrl(nextPath, {
      error_code: AUTH_ERROR_CODES.INVALID_EMAIL_SIGN_UP,
      error_message: "INVALID_EMAIL_SIGN_UP",
    }));
  }

  // Validate password (min 8 chars)
  const parseResult = signUpSchema.safeParse({ email, password });
  if (!parseResult.success) {
    if (isJson) {
      return c.json({ detail: "Password must be between 8 and 128 characters." }, 400);
    }
    return c.redirect(buildRedirectUrl(nextPath, {
      error_code: AUTH_ERROR_CODES.INVALID_PASSWORD,
      error_message: "INVALID_PASSWORD",
    }));
  }

  // Check if user already exists (matching Django's explicit check before provider call)
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existingUser) {
    if (isJson) {
      return c.json({ email: ["A user with this email already exists."] }, 400);
    }
    return c.redirect(buildRedirectUrl(nextPath, {
      error_code: AUTH_ERROR_CODES.USER_ALREADY_EXIST,
      error_message: "USER_ALREADY_EXIST",
    }));
  }

  try {
    const name = [firstName, lastName].filter(Boolean).join(" ");
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: name || "User",
        firstName: firstName || "",
        lastName: lastName || "",
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
      if (isJson) {
        if (data.message?.includes("already exists")) {
          return c.json({ email: ["A user with this email already exists."] }, 400);
        }
        return c.json({ detail: data.message || "Failed to create account." }, 400);
      }
      return c.redirect(buildRedirectUrl(nextPath, {
        error_code: AUTH_ERROR_CODES.AUTHENTICATION_FAILED_SIGN_UP,
        error_message: "AUTHENTICATION_FAILED_SIGN_UP",
      }));
    }

    const data = (await result.json()) as { user: Record<string, unknown>; token?: string };
    const userId = data.user.id as string;
    const userEmail = data.user.email as string;

    // Post-signup workflow: process accepted workspace invitations
    await processWorkspaceInvitations(userId, userEmail);

    if (isJson) {
      return c.json({
        user: formatUserResponse(data.user),
        access_token: data.token,
      });
    }

    // Form submission: redirect to appropriate path
    const path = nextPath || await getRedirectionPath(userId, userEmail);
    return c.redirect(buildRedirectUrl(path));

  } catch (error) {
    console.error("[Auth] Sign up error:", error);
    if (isJson) {
      return c.json({ detail: "Failed to create account." }, 400);
    }
    return c.redirect(buildRedirectUrl(nextPath, {
      error_code: AUTH_ERROR_CODES.AUTHENTICATION_FAILED_SIGN_UP,
      error_message: "AUTHENTICATION_FAILED_SIGN_UP",
    }));
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
// Supports both JSON and form POST (matching Django's MagicSignInEndpoint)
authRoutes.post("/magic-sign-in/", async (c) => {
  let code: string | undefined;
  let email: string | undefined;
  let nextPath: string | undefined;

  const contentType = c.req.header("content-type");
  const isJson = contentType?.includes("application/json");

  if (isJson) {
    const body = await c.req.json();
    code = body.token || body.key || body.code;
    email = body.email;
    nextPath = body.next_path;
  } else {
    const body = await c.req.parseBody();
    code = (body["code"] as string)?.trim();
    email = (body["email"] as string)?.trim().toLowerCase();
    nextPath = body["next_path"] as string | undefined;
  }

  // Support both token (from URL) and key (from code entry)
  const magicToken = code;

  if (!magicToken) {
    if (isJson) {
      return c.json({ detail: "Token is required." }, 400);
    }
    return c.redirect(buildRedirectUrl(nextPath, {
      error_code: 5085, // MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED
      error_message: "MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED",
    }));
  }

  // For form-based sign-in, verify user exists
  if (!isJson && email) {
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (!existingUser) {
      return c.redirect(buildRedirectUrl(nextPath, {
        error_code: AUTH_ERROR_CODES.USER_DOES_NOT_EXIST,
        error_message: "USER_DOES_NOT_EXIST",
      }));
    }
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
      if (isJson) {
        return c.json(
          { detail: data.message || "Invalid or expired magic link." },
          400
        );
      }
      return c.redirect(buildRedirectUrl(nextPath, {
        error_code: 5090, // INVALID_MAGIC_CODE_SIGN_IN
        error_message: "INVALID_MAGIC_CODE_SIGN_IN",
      }));
    }

    const data = (await result.json()) as { user: Record<string, unknown>; token?: string };
    const userId = data.user.id as string;
    const userEmail = data.user.email as string;

    // Post-login workflow: process accepted workspace invitations
    await processWorkspaceInvitations(userId, userEmail);

    if (isJson) {
      return c.json({
        user: formatUserResponse(data.user),
        access_token: data.token,
      });
    }

    // Form submission: redirect to appropriate path
    const path = nextPath || await getRedirectionPath(userId, userEmail);
    return c.redirect(buildRedirectUrl(path));

  } catch (error) {
    console.error("[Auth] Magic sign in error:", error);
    if (isJson) {
      return c.json({ detail: "Invalid or expired magic link." }, 400);
    }
    return c.redirect(buildRedirectUrl(nextPath, {
      error_code: AUTH_ERROR_CODES.AUTHENTICATION_FAILED_SIGN_IN,
      error_message: "AUTHENTICATION_FAILED_SIGN_IN",
    }));
  }
});

// Magic link - sign up (for new users using magic code)
// Matches Django's MagicSignUpEndpoint
authRoutes.post("/magic-sign-up/", async (c) => {
  let code: string | undefined;
  let email: string | undefined;
  let nextPath: string | undefined;

  const contentType = c.req.header("content-type");
  const isJson = contentType?.includes("application/json");

  if (isJson) {
    const body = await c.req.json();
    code = body.code;
    email = body.email;
    nextPath = body.next_path;
  } else {
    const body = await c.req.parseBody();
    code = (body["code"] as string)?.trim();
    email = (body["email"] as string)?.trim().toLowerCase();
    nextPath = body["next_path"] as string | undefined;
  }

  // Validate required fields
  if (!code || !email) {
    if (isJson) {
      return c.json({ detail: "Email and code are required." }, 400);
    }
    return c.redirect(buildRedirectUrl(nextPath, {
      error_code: AUTH_ERROR_CODES.MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED,
      error_message: "MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED",
    }));
  }

  email = email.trim().toLowerCase();

  // Validate email
  if (!isValidEmail(email)) {
    if (isJson) {
      return c.json({ detail: "Invalid email address." }, 400);
    }
    return c.redirect(buildRedirectUrl(nextPath, {
      error_code: AUTH_ERROR_CODES.INVALID_EMAIL_MAGIC_SIGN_UP,
      error_message: "INVALID_EMAIL_MAGIC_SIGN_UP",
    }));
  }

  // Check if user already exists
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existingUser) {
    if (isJson) {
      return c.json({ detail: "A user with this email already exists." }, 400);
    }
    return c.redirect(buildRedirectUrl(nextPath, {
      error_code: AUTH_ERROR_CODES.USER_ALREADY_EXIST,
      error_message: "USER_ALREADY_EXIST",
    }));
  }

  try {
    // Verify magic code via Better Auth
    const result = await auth.api.magicLinkVerify({
      query: { token: code },
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
      if (isJson) {
        return c.json({ detail: data.message || "Invalid or expired magic code." }, 400);
      }
      // Map to appropriate error code
      const errorMessage = data.message || "";
      const errorCode = errorMessage.includes("expired")
        ? 5097 // EXPIRED_MAGIC_CODE_SIGN_UP
        : 5092; // INVALID_MAGIC_CODE_SIGN_UP
      return c.redirect(buildRedirectUrl(nextPath, {
        error_code: errorCode,
        error_message: errorMessage.includes("expired")
          ? "EXPIRED_MAGIC_CODE_SIGN_UP"
          : "INVALID_MAGIC_CODE_SIGN_UP",
      }));
    }

    const data = (await result.json()) as { user: Record<string, unknown>; token?: string };
    const userId = data.user.id as string;
    const userEmail = data.user.email as string;

    // Mark the user as having an auto-set password (since they signed up with magic link)
    await db.update(users).set({
      isPasswordAutoset: true,
      updatedAt: new Date(),
    }).where(eq(users.email, userEmail));

    // Post-signup workflow: process accepted workspace invitations
    await processWorkspaceInvitations(userId, userEmail);

    if (isJson) {
      return c.json({
        user: formatUserResponse(data.user),
        access_token: data.token,
      });
    }

    // Form submission: redirect to appropriate path
    const path = nextPath || await getRedirectionPath(userId, userEmail);
    return c.redirect(buildRedirectUrl(path));

  } catch (error) {
    console.error("[Auth] Magic sign up error:", error);
    if (isJson) {
      return c.json({ detail: "Invalid or expired magic code." }, 400);
    }
    return c.redirect(buildRedirectUrl(nextPath, {
      error_code: AUTH_ERROR_CODES.AUTHENTICATION_FAILED_SIGN_UP,
      error_message: "AUTHENTICATION_FAILED_SIGN_UP",
    }));
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
