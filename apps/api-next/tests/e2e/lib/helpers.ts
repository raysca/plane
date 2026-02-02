import type { Page } from "@playwright/test";

/**
 * Generate a unique test email address using a timestamp + random suffix.
 */
export function generateTestEmail(prefix = "e2e"): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${id}@test.local`;
}

/**
 * Generate a unique workspace slug.
 */
export function generateWorkspaceSlug(prefix = "e2e-ws"): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}-${id}`;
}

/**
 * Generate a strong test password that meets the 8-char minimum.
 */
export function generateTestPassword(): string {
  return `Test@${Date.now().toString(36)}!`;
}

/**
 * Wait for the app to finish loading (no pending network requests, spinners gone).
 */
export async function waitForAppReady(page: Page) {
  await page.waitForLoadState("networkidle");
}

/**
 * Extract CSRF token from the page cookies or meta tag.
 */
export async function getCsrfToken(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name.includes("csrf"));
  return csrf?.value ?? null;
}
