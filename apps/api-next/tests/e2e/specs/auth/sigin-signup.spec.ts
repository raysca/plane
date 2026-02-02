import { test, expect } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  waitForAppReady,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

test.describe("Authentication", () => {
  test("should sign up a new user via the UI", async ({ page }) => {
    const email = generateTestEmail("signup");
    const password = generateTestPassword();

    await page.goto("/sign-up");
    await waitForAppReady(page);

    // Fill in email
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    await emailInput.fill(email);

    // Submit email step
    const continueButton = page.getByRole("button", { name: /continue/i });
    await continueButton.click();

    // Fill in password and confirm password
    const passwordInput = page.locator("#password");
    await expect(passwordInput).toBeVisible({ timeout: 10_000 });
    await passwordInput.fill(password);

    const confirmPasswordInput = page.locator("#confirm-password");
    if (await confirmPasswordInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmPasswordInput.fill(password);
    }

    // Submit sign up
    const signUpButton = page.getByRole("button", { name: /sign up|create account|continue/i });
    await signUpButton.click();

    // Should redirect away from sign-up (to onboarding or workspace)
    await page.waitForURL((url) => !url.pathname.includes("/sign-up"), {
      timeout: 30_000,
    });

    // Verify we're authenticated by checking we're not on the login page
    const currentUrl = page.url();
    expect(currentUrl).not.toContain("/sign-up");
  });

  test("should sign in an existing user via the UI", async ({ page, request }) => {
    const email = generateTestEmail("signin");
    const password = generateTestPassword();

    // Create user via API first
    const signupResponse = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "Sign", last_name: "In" },
    });
    expect(signupResponse.ok()).toBeTruthy();

    // Now sign in via UI
    await page.goto("/");
    await waitForAppReady(page);

    // Fill in email
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    await emailInput.fill(email);

    const continueButton = page.getByRole("button", { name: /continue/i });
    await continueButton.click();

    // Fill in password
    const passwordInput = page.locator("#password");
    await expect(passwordInput).toBeVisible({ timeout: 10_000 });
    await passwordInput.fill(password);

    // Submit sign in
    const signInButton = page.locator('button[type="submit"]');
    await signInButton.click();

    // Should redirect away from login page
    await page.waitForURL((url) => url.pathname !== "/" || url.search !== "", {
      timeout: 30_000,
    });
  });

  test("should sign up and sign in via the API", async ({ request }) => {
    const email = generateTestEmail("api-auth");
    const password = generateTestPassword();

    // Sign up
    const signupResponse = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: {
        email,
        password,
        first_name: "API",
        last_name: "Test",
      },
    });
    expect(signupResponse.ok()).toBeTruthy();

    const signupData = await signupResponse.json();
    expect(signupData.user).toBeDefined();
    expect(signupData.user.email).toBe(email);
    expect(signupData.access_token).toBeDefined();

    // Sign in
    const signinResponse = await request.post(`${API_BASE}/auth/sign-in/`, {
      data: { email, password },
    });
    expect(signinResponse.ok()).toBeTruthy();

    const signinData = await signinResponse.json();
    expect(signinData.user).toBeDefined();
    expect(signinData.user.email).toBe(email);
    expect(signinData.access_token).toBeDefined();
  });

  test("should reject sign up with existing email", async ({ request }) => {
    const email = generateTestEmail("duplicate");
    const password = generateTestPassword();

    // First signup
    const first = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "First", last_name: "User" },
    });
    expect(first.ok()).toBeTruthy();

    // Duplicate signup
    const second = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "Second", last_name: "User" },
    });
    expect(second.ok()).toBeFalsy();
    expect(second.status()).toBe(400);
  });

  test("should reject sign in with wrong password", async ({ request }) => {
    const email = generateTestEmail("wrongpw");
    const password = generateTestPassword();

    // Create user
    await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "Wrong", last_name: "PW" },
    });

    // Sign in with wrong password
    const response = await request.post(`${API_BASE}/auth/sign-in/`, {
      data: { email, password: "WrongPassword123!" },
    });
    expect(response.ok()).toBeFalsy();
  });
});
