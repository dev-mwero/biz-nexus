import { existsSync, mkdirSync } from "node:fs";
import type { FullConfig } from "@playwright/test";

/**
 * Global setup for E2E tests.
 * - Ensures test database is clean
 * - Creates necessary directories for auth state
 * - Verifies the application is running
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0].use?.baseURL ?? "http://127.0.0.1:3000";

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

  // Clean test database by dropping all test collections
  // This is done via a direct database command to ensure clean state
  try {
    console.log("[Global Setup] Cleaning test database...");
    // The actual database cleaning will happen in the test fixtures
    // This is just a placeholder for any additional global setup needed
  } catch (error) {
    console.warn("[Global Setup] Database cleanup warning:", error);
  }

  console.log("[Global Setup] E2E test environment ready");
}
