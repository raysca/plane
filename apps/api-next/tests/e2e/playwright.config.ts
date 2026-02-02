import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_PORT = process.env.API_PORT || "8000";
const WEB_PORT = process.env.WEB_PORT || "3000";
const apiNextRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // In CI, start both servers automatically. Locally, assume they're already running.
  ...(process.env.CI
    ? {
      globalSetup: "./global-setup.ts",
      globalTeardown: "./global-teardown.ts",
      webServer: [
        {
          command: `DATABASE_URL=file:${path.resolve(__dirname, ".test-data/test.db")} PORT=${API_PORT} BETTER_AUTH_SECRET=e2e-test-secret BETTER_AUTH_URL=http://localhost:${API_PORT} FRONTEND_URL=http://localhost:${WEB_PORT} NODE_ENV=development bun src/index.ts`,
          cwd: apiNextRoot,
          url: `http://localhost:${API_PORT}/api/health/`,
          timeout: 30_000,
          stdout: "pipe",
          stderr: "pipe",
        },
        {
          command: `NEXT_PUBLIC_API_BASE_URL=http://localhost:${API_PORT} pnpm --filter web dev`,
          cwd: path.resolve(apiNextRoot, ".."),
          url: `http://localhost:${WEB_PORT}`,
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
      ],
    }
    : {}),
});
