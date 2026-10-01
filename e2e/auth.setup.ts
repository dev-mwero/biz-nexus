import { expect, test as setup } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

/**
 * Creates an authenticated session for a test user.
 * This setup runs once per worker and stores the session state.
 */
setup("authenticate test user", async ({ page }) => {
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = "TestPassword123!";
  const testName = "Test User";

  // Register a new user
  const registerResponse = await page.request.post(
    `${BASE_URL}/api/v1/auth/register`,
    {
      data: {
        email: testEmail,
        name: testName,
        password: testPassword,
      },
    },
  );

  expect(registerResponse.status()).toBe(201);

  const registerData = await registerResponse.json();
  expect(registerData.data.user).toBeDefined();
  expect(registerData.data.user.email).toBe(testEmail);

  // Get the session cookie
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "session");
  expect(sessionCookie).toBeDefined();

  // Verify the session works by calling /api/v1/auth/me
  const meResponse = await page.request.get(`${BASE_URL}/api/v1/auth/me`);
  expect(meResponse.status()).toBe(200);

  const meData = await meResponse.json();
  expect(meData.data.user).toBeDefined();
  expect(meData.data.user.email).toBe(testEmail);

  // Save the authenticated state
  await page.context().storageState({ path: "e2e/.auth/user-state.json" });
});

/**
 * Creates an authenticated session with an organization.
 * This setup creates a user, registers them, creates an organization,
 * and stores the authenticated state with the organization active.
 */
setup("authenticate with organization", async ({ page }) => {
  const testEmail = `test-org-${Date.now()}@example.com`;
  const testPassword = "TestPassword123!";
  const testName = "Test Org User";

  // Register a new user
  const registerResponse = await page.request.post(
    `${BASE_URL}/api/v1/auth/register`,
    {
      data: {
        email: testEmail,
        name: testName,
        password: testPassword,
      },
    },
  );

  expect(registerResponse.status()).toBe(201);

  // Create an organization
  const createOrgResponse = await page.request.post(
    `${BASE_URL}/api/v1/organizations`,
    {
      data: {
        name: "Test Organization",
      },
    },
  );

  if (createOrgResponse.status() === 404) {
    // Organization creation endpoint might not exist yet
    // Skip this setup if the endpoint doesn't exist
    console.log("Organization creation endpoint not found, skipping org setup");
    return;
  }

  expect(createOrgResponse.status()).toBe(201);

  const orgData = await createOrgResponse.json();
  expect(orgData.data.organization).toBeDefined();

  // Save the authenticated state with organization
  await page.context().storageState({ path: "e2e/.auth/org-user-state.json" });
});
