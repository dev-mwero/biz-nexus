import type { APIResponse } from "@playwright/test";
import { expect, test as setup } from "./fixtures";

/**
 * The session cookie's name. Must match `SESSION_COOKIE` in
 * `src/shared/auth/session-cookie.ts`; the suite fails loudly if it drifts.
 */
const SESSION_COOKIE = "bn_session";

/**
 * Read the session cookie out of a response's `Set-Cookie` header.
 *
 * The E2E server runs in production mode, where the cookie is `Secure`, and the
 * suite talks to it over plain HTTP. A real browser would refuse to send it, and
 * so would Playwright's cookie jar — so the value is carried explicitly on the
 * requests that need it rather than relied on to survive the jar.
 */
function sessionCookieHeader(response: APIResponse): string {
  const setCookie = response.headers()["set-cookie"] ?? "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) {
    throw new Error(`Response did not set a ${SESSION_COOKIE} cookie.`);
  }
  return `${SESSION_COOKIE}=${match[1]}`;
}

/**
 * Creates an authenticated session for a test user, with no active
 * organisation. This is the state a freshly registered account is actually in,
 * and the starting point for the onboarding flow.
 */
setup("authenticate test user", async ({ request }) => {
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = "TestPassword123!";
  const testName = "Test User";

  const registerResponse = await request.post("/api/v1/auth/register", {
    data: {
      email: testEmail,
      name: testName,
      password: testPassword,
    },
  });

  expect(registerResponse.status()).toBe(201);

  const registerData = await registerResponse.json();
  expect(registerData.data.user).toBeDefined();
  expect(registerData.data.user.email).toBe(testEmail);

  const cookie = sessionCookieHeader(registerResponse);

  // Verify the session actually authenticates: registration sets the cookie, a
  // 200 from /auth/me proves the server accepts it.
  const meResponse = await request.get("/api/v1/auth/me", {
    headers: { Cookie: cookie },
  });
  expect(meResponse.status()).toBe(200);

  const meData = await meResponse.json();
  expect(meData.data.user).toBeDefined();
  expect(meData.data.user.email).toBe(testEmail);

  await request.storageState({ path: "e2e/.auth/user-state.json" });
});

/**
 * Creates an authenticated session whose account has created and activated an
 * organisation. The organisation becomes active on the same session, so the
 * cookie captured here can reach the organisation-scoped API.
 */
setup("authenticate with organization", async ({ request }) => {
  const testEmail = `test-org-${Date.now()}@example.com`;
  const testPassword = "TestPassword123!";
  const testName = "Test Org User";

  const registerResponse = await request.post("/api/v1/auth/register", {
    data: {
      email: testEmail,
      name: testName,
      password: testPassword,
    },
  });

  expect(registerResponse.status()).toBe(201);

  const cookie = sessionCookieHeader(registerResponse);

  const createOrgResponse = await request.post("/api/v1/organizations", {
    headers: { Cookie: cookie },
    data: {
      name: "Test Organization",
    },
  });

  expect(createOrgResponse.status()).toBe(201);

  const orgData = await createOrgResponse.json();
  expect(orgData.data.organization).toBeDefined();
  expect(orgData.data.organization.id).toBeDefined();

  // The created organisation is the session's active one, so organisation-scoped
  // calls with this cookie now resolve.
  const meResponse = await request.get("/api/v1/auth/me", {
    headers: { Cookie: cookie },
  });
  expect(meResponse.status()).toBe(200);
  const meData = await meResponse.json();
  expect(meData.data.activeOrganizationId).toBe(orgData.data.organization.id);

  await request.storageState({ path: "e2e/.auth/org-user-state.json" });
});
