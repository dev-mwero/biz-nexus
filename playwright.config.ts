import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Authorization and tenant-isolation failures are the ones that must never
  // be missed, so a failure never silently runs a single retry. The suite is
  // allowed to be slow in exchange for being trusted.
  retries: 0,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // The end-to-end suite runs against a real application server, so it
      // needs a real database. MONGODB_URI comes from .env.local, which Next
      // loads itself; only the test overrides are forced here.
      NODE_ENV: "development",
      MAIL_DRIVER: "console",
      RATELIMIT_DRIVER: "memory",
    },
  },
});
