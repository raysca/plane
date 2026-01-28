import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";

const CSRF_COOKIE_NAME = "plane_csrf_token";
const CSRF_HEADER_NAME = "x-csrftoken";
const CSRF_TOKEN_LENGTH = 32;

/**
 * Generate a cryptographically secure CSRF token
 */
function generateCsrfToken(): string {
  const array = new Uint8Array(CSRF_TOKEN_LENGTH);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * CSRF token generation middleware
 * Sets a CSRF cookie if not present
 */
export const csrfTokenMiddleware = createMiddleware(async (c, next) => {
  let csrfToken = getCookie(c, CSRF_COOKIE_NAME);

  if (!csrfToken) {
    csrfToken = generateCsrfToken();
    setCookie(c, CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false, // Must be accessible by JavaScript
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
  }

  // Store token in context for use in handlers
  c.set("csrfToken", csrfToken);

  await next();
});

/**
 * CSRF validation middleware
 * Validates CSRF token on state-changing requests (POST, PUT, PATCH, DELETE)
 */
export const csrfValidationMiddleware = createMiddleware(async (c, next) => {
  const method = c.req.method;

  // Safe methods don't need CSRF validation
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    await next();
    return;
  }

  // Get token from cookie
  const cookieToken = getCookie(c, CSRF_COOKIE_NAME);

  // Get token from header
  const headerToken = c.req.header(CSRF_HEADER_NAME);

  // Both must be present and match
  if (!cookieToken || !headerToken) {
    return c.json(
      { detail: "CSRF token missing. Include X-CSRFToken header." },
      403
    );
  }

  if (cookieToken !== headerToken) {
    return c.json({ detail: "CSRF token validation failed." }, 403);
  }

  await next();
});

/**
 * Get CSRF token from context
 */
export function getCsrfToken(c: { get: (key: string) => string | undefined }): string | undefined {
  return c.get("csrfToken");
}
