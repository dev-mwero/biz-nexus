import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  // Critical/isolation paths pass state between ordered steps; keep each file
  // serial so worker scheduling cannot race that shared setup.
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      // Production boot refuses console mail. Registration currently does not
      // send mail, so use complete SMTP configuration for the E2E server.
      MAIL_DRIVER: "smtp",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "2525",
      SMTP_USER: "e2e",
      SMTP_PASSWORD: "e2e-only",
      RATELIMIT_DRIVER: "memory",
    },
  },
});
