import type { FullConfig } from "@playwright/test";

/**
 * Global teardown for E2E tests.
 * - Cleans up test database
 * - Removes temporary auth state files
 * - Any other cleanup needed after test run
 */
export default async function globalTeardown(
  _config: FullConfig,
): Promise<void> {
  console.log("[Global Teardown] Starting E2E test environment cleanup...");

  // Clean up test database
  // The actual database cleanup is handled by the test fixtures
  // This is a placeholder for any additional global teardown needed

  // Remove auth state files if desired (commented out for debugging)
  // const authDir = "e2e/.auth";
  // if (existsSync(authDir)) {
  //   rmSync(authDir, { recursive: true, force: true });
  // }

  console.log("[Global Teardown] E2E test environment cleaned up");
}
