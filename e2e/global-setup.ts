import { existsSync, mkdirSync } from "node:fs";
import type { FullConfig } from "@playwright/test";

/**
 * Global setup for E2E tests: creates the auth-state directory and waits for the
 * server to answer.
 *
 * **It does not clean the database, and nothing here needs it to.** The clean
 * database comes from `scripts/e2e-server.mjs`, which boots a throwaway
 * in-memory MongoDB replica set for the web server to use. That replica set is
 * created fresh for every run and destroyed on shutdown, so "from a clean
 * database" is a property of the harness rather than a step somebody has to
 * remember. An earlier version of this file carried a "Cleaning test database"
 * block whose body was a comment saying the cleaning happened elsewhere — the
 * sort of thing that reads as a step someone skipped until the day a run fails
 * on leftover state and nobody can tell which.
 *
 * The replica set is a single node rather than a standalone `mongod` because
 * services use multi-document transactions, which MongoDB only offers on a
 * replica set.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects.find((project) => project.use?.baseURL)?.use?.baseURL ??
    process.env.PLAYWRIGHT_BASE_URL ??
    `http://localhost:${process.env.PLAYWRIGHT_PORT ?? 3100}`;

  console.log("[Global Setup] Starting E2E test environment setup...");

  // Create .auth directory for storing authenticated states
  const authDir = "e2e/.auth";
  if (!existsSync(authDir)) {
    mkdirSync(authDir, { recursive: true });
  }

  // Verify the web server is running
  console.log(`[Global Setup] Checking server at ${baseURL}...`);
  let retries = 30;
  while (retries > 0) {
    try {
      const response = await fetch(`${baseURL}/api/v1/auth/me`);
      // 401 is expected for unauthenticated requests
      if (response.status === 401 || response.status === 200) {
        console.log("[Global Setup] Server is reachable");
        break;
      }
    } catch {
      // Server not ready yet
    }
    retries--;
    if (retries === 0) {
      throw new Error(
        `[Global Setup] Server at ${baseURL} did not become ready in time`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("[Global Setup] E2E test environment ready");
}
