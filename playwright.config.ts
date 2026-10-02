import { defineConfig, devices } from "@playwright/test";

/**
 * The E2E server runs on its own port, not 3000.
 *
 * 3000 is where a developer's `next dev` usually is, and `reuseExistingServer`
 * would then silently point the suite at that server — which runs in
 * development, may be mid-recompile, and is not the artefact under test. A
 * dedicated port keeps the two independent: the suite always boots the
 * production build it just made, and a running dev server neither breaks the
 * suite nor is disturbed by it.
 */
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);

// Must match the server's APP_URL origin: every mutating API route checks the
// request Origin against it. `localhost` is the host src/env.ts allows over
// plain HTTP in production, which is how the E2E server boots.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

/**
 * Test-only session signing key.
 *
 * Production boot refuses the `.env.example` placeholder, and the suite must
 * not depend on a developer's local secret to run.
 */
const E2E_SESSION_SECRET =
  "e2e-only-session-signing-key-not-for-production-use";

// Build output for the E2E server. Kept out of `.next` so a running `next dev`
// and the suite's production build cannot clobber one another.
const distDir = ".next-e2e";

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
    // Boots a throwaway in-memory MongoDB replica set, then the production
    // server built into `distDir`. The build is a separate step (see the
    // `test:e2e` script) so Playwright's timeout is not spent compiling.
    command: "node scripts/e2e-server.mjs",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      NEXT_DIST_DIR: distDir,
      PORT: String(port),
      APP_URL: baseURL,
      SESSION_SECRET: E2E_SESSION_SECRET,
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
