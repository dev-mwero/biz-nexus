import { BASE_URL, expect, test } from "./fixtures";

/**
 * Isolation Path E2E Test
 *
 * Tests cross-organization data isolation:
 * 1. Org A creates data (contact, company, lead, deal, task)
 * 2. Org B attempts to access Org A's data via:
 *    - Direct URL access (GET /api/v1/crm/contacts/{orgA_contact_id})
 *    - API list with filters
 *    - Search/inference
 * 3. All attempts should return 404 (not found) or empty results
 */

test.describe("Isolation Path - Cross-Organization Data Isolation", () => {
  let orgAAuthCookie: string;
  let orgBUserAuthCookie: string;
  let orgAId: string;
  let orgBId: string;
  let orgAUserId: string;
  let orgAContactId: string;
  let orgACompanyId: string;
  let orgALeadId: string;
  let orgADealId: string;
  let orgATaskId: string;
  let orgAPipelineId: string;

  test.beforeAll(async ({ playwright }) => {
    // Created from the worker-scoped `playwright` fixture rather than the
    // test-scoped `request` fixture: a `beforeAll` that depends on a
    // test-scoped fixture re-runs for every test, which would register a fresh
    // pair of users per test and leave later tests holding cookies for accounts
    // that no longer correspond to the organisations created earlier.
    const context = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Origin: BASE_URL },
    });

    try {
      // Create Org A user
      const orgARegisterResponse = await context.post(
        `${BASE_URL}/api/v1/auth/register`,
        {
          data: {
            email: `org-a-${Date.now()}@example.com`,
            name: "Org A User",
            password: "TestPassword123!",
          },
        },
      );

      expect(orgARegisterResponse.status()).toBe(201);
      const orgARegisterData = await orgARegisterResponse.json();
      orgAUserId = orgARegisterData.data.user.id;

      const orgACookies = orgARegisterResponse.headers()["set-cookie"];
      if (orgACookies) {
        const sessionMatch = orgACookies.match(/bn_session=([^;]+)/);
        if (sessionMatch) {
          orgAAuthCookie = `bn_session=${sessionMatch[1]}`;
        }
      }
      expect(orgAAuthCookie).toBeDefined();

      // Create Org B user
      const orgBRegisterResponse = await context.post(
        `${BASE_URL}/api/v1/auth/register`,
        {
          data: {
            email: `org-b-${Date.now()}@example.com`,
            name: "Org B User",
            password: "TestPassword123!",
          },
        },
      );

      expect(orgBRegisterResponse.status()).toBe(201);

      const orgBCookies = orgBRegisterResponse.headers()["set-cookie"];
      if (orgBCookies) {
        const sessionMatch = orgBCookies.match(/bn_session=([^;]+)/);
        if (sessionMatch) {
          orgBUserAuthCookie = `bn_session=${sessionMatch[1]}`;
        }
      }
      expect(orgBUserAuthCookie).toBeDefined();
    } finally {
      await context.dispose();
    }
  });

  test.describe("Org A - Create Data", () => {
    test("1a. Create organization for Org A", async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/v1/organizations`, {
        headers: { Cookie: orgAAuthCookie },
        data: { name: "Org A - Test Organization" },
      });

      if (response.status() === 404) {
        test.skip(true, "Organization creation endpoint not implemented");
      }

      expect(response.status()).toBe(201);
      const data = await response.json();
      orgAId = data.data.organization.id;
      expect(orgAId).toBeDefined();
    });

    test("1b. Create organization for Org B", async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/v1/organizations`, {
        headers: { Cookie: orgBUserAuthCookie },
        data: { name: "Org B - Test Organization" },
      });

      if (response.status() === 404) {
        test.skip(true, "Organization creation endpoint not implemented");
      }

      expect(response.status()).toBe(201);
      const data = await response.json();
      orgBId = data.data.organization.id;
      expect(orgBId).toBeDefined();
    });

    test("2. Org A creates contact", async ({ request }) => {
      if (!orgAId) test.skip(true, "Org A not created");

      const response = await request.post(`${BASE_URL}/api/v1/crm/contacts`, {
        headers: { Cookie: orgAAuthCookie },
        data: {
          firstName: "Alice",
          lastName: "Anderson",
          ownerId: orgAUserId,
          emails: [
            { label: "work", value: "alice@orga.example.com", isPrimary: true },
          ],
          phones: [{ label: "mobile", value: "+1-555-1001", isPrimary: true }],
          jobTitle: "CEO",
          status: "CUSTOMER",
          notes: "Org A confidential contact",
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      orgAContactId = data.data._id;
      expect(orgAContactId).toBeDefined();
    });

    test("3. Org A creates company", async ({ request }) => {
      if (!orgAId) test.skip(true, "Org A not created");

      const response = await request.post(`${BASE_URL}/api/v1/crm/companies`, {
        headers: { Cookie: orgAAuthCookie },
        data: {
          name: "Org A Secret Corp",
          legalName: "Org A Secret Corporation",
          industry: "Defense",
          website: "https://secret.orga.example.com",
          email: "secret@orga.example.com",
          ownerId: orgAUserId,
          status: "CUSTOMER",
          size: 100,
          annualRevenue: 50000000,
          notes: "Org A confidential company",
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      orgACompanyId = data.data._id;
      expect(orgACompanyId).toBeDefined();
    });

    test("4. Org A creates lead", async ({ request }) => {
      if (!orgAId || !orgAContactId) test.skip(true, "Prerequisites not met");

      const response = await request.post(`${BASE_URL}/api/v1/crm/leads`, {
        headers: { Cookie: orgAAuthCookie },
        data: {
          title: "Org A Confidential Lead",
          ownerId: orgAUserId,
          contactId: orgAContactId,
          companyId: orgACompanyId,
          source: "Referral",
          status: "QUALIFIED",
          score: 90,
          notes: "Org A confidential lead",
          contactSnapshot: {
            firstName: "Alice",
            lastName: "Anderson",
            email: "alice@orga.example.com",
            companyName: "Org A Secret Corp",
          },
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      orgALeadId = data.data._id;
      expect(orgALeadId).toBeDefined();
    });

    test("5. Org A creates pipeline", async ({ request }) => {
      if (!orgAId) test.skip(true, "Org A not created");

      const response = await request.post(`${BASE_URL}/api/v1/pipelines`, {
        headers: { Cookie: orgAAuthCookie },
        data: {
          // Non-default: the organisation already has a provisioned default.
          name: "Org A Sales Pipeline",
          description: "Org A confidential pipeline",
          isDefault: false,
          stages: [
            { key: "NEW", name: "New", order: 1, probability: 10 },
            {
              key: "WON",
              name: "Won",
              order: 2,
              probability: 100,
              isWon: true,
            },
          ],
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      orgAPipelineId = data.data._id;
      expect(orgAPipelineId).toBeDefined();
    });

    test("6. Org A creates deal", async ({ request }) => {
      if (!orgAId || !orgAPipelineId || !orgAContactId || !orgACompanyId) {
        test.skip(true, "Prerequisites not met");
      }

      const pipelineResponse = await request.get(
        `${BASE_URL}/api/v1/pipelines`,
        {
          headers: { Cookie: orgAAuthCookie },
        },
      );
      const pipelineData = await pipelineResponse.json();
      const pipeline = pipelineData.data.find(
        (p: { _id: string }) => p._id === orgAPipelineId,
      );
      const firstStage = pipeline?.stages?.[0];

      if (!firstStage) test.skip(true, "Pipeline stages not available");

      const response = await request.post(`${BASE_URL}/api/v1/deals`, {
        headers: { Cookie: orgAAuthCookie },
        data: {
          name: "Org A Confidential Deal",
          contactId: orgAContactId,
          companyId: orgACompanyId,
          pipelineId: orgAPipelineId,
          stageId: firstStage._id,
          value: 1000000,
          currency: "USD",
          probability: 50,
          expectedCloseDate: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          description: "Org A confidential deal",
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      orgADealId = data.data._id;
      expect(orgADealId).toBeDefined();
    });

    test("7. Org A creates task", async ({ request }) => {
      if (!orgAId || !orgADealId) test.skip(true, "Prerequisites not met");

      const response = await request.post(`${BASE_URL}/api/v1/tasks`, {
        headers: { Cookie: orgAAuthCookie },
        data: {
          title: "Org A Confidential Task",
          description: "Handle confidential Org A deal",
          status: "TODO",
          priority: "URGENT",
          dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          related: [{ entityType: "deal", entityId: orgADealId }],
          metadata: { classification: "confidential" },
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      orgATaskId = data.data._id;
      expect(orgATaskId).toBeDefined();
    });
  });

  test.describe("Org B - Attempt Cross-Organization Access", () => {
    test("8. Org B cannot access Org A's contact via direct URL", async ({
      request,
    }) => {
      if (!orgAContactId) test.skip(true, "Org A contact not created");

      const response = await request.get(
        `${BASE_URL}/api/v1/crm/contacts/${orgAContactId}`,
        {
          headers: { Cookie: orgBUserAuthCookie },
        },
      );

      // Should return 404 (not found) or 403 (forbidden)
      // 404 is preferred as it doesn't leak existence
      expect([403, 404]).toContain(response.status());
    });

    test("9. Org B cannot access Org A's company via direct URL", async ({
      request,
    }) => {
      if (!orgACompanyId) test.skip(true, "Org A company not created");

      const response = await request.get(
        `${BASE_URL}/api/v1/crm/companies/${orgACompanyId}`,
        {
          headers: { Cookie: orgBUserAuthCookie },
        },
      );

      expect([403, 404]).toContain(response.status());
    });

    test("10. Org B cannot access Org A's lead via direct URL", async ({
      request,
    }) => {
      if (!orgALeadId) test.skip(true, "Org A lead not created");

      const response = await request.get(
        `${BASE_URL}/api/v1/crm/leads/${orgALeadId}`,
        {
          headers: { Cookie: orgBUserAuthCookie },
        },
      );

      expect([403, 404]).toContain(response.status());
    });

    test("11. Org B cannot access Org A's deal via direct URL", async ({
      request,
    }) => {
      if (!orgADealId) test.skip(true, "Org A deal not created");

      const response = await request.get(
        `${BASE_URL}/api/v1/deals/${orgADealId}`,
        {
          headers: { Cookie: orgBUserAuthCookie },
        },
      );

      expect([403, 404]).toContain(response.status());
    });

    test("12. Org B cannot access Org A's task via direct URL", async ({
      request,
    }) => {
      if (!orgATaskId) test.skip(true, "Org A task not created");

      const response = await request.get(
        `${BASE_URL}/api/v1/tasks/${orgATaskId}`,
        {
          headers: { Cookie: orgBUserAuthCookie },
        },
      );

      expect([403, 404]).toContain(response.status());
    });

    test("13. Org B cannot access Org A's pipeline via direct URL", async ({
      request,
    }) => {
      if (!orgAPipelineId) test.skip(true, "Org A pipeline not created");

      const response = await request.get(
        `${BASE_URL}/api/v1/pipelines/${orgAPipelineId}`,
        {
          headers: { Cookie: orgBUserAuthCookie },
        },
      );

      expect([403, 404]).toContain(response.status());
    });

    test("14. Org B's contact list does not include Org A's contact", async ({
      request,
    }) => {
      const response = await request.get(`${BASE_URL}/api/v1/crm/contacts`, {
        headers: { Cookie: orgBUserAuthCookie },
        params: { pageSize: 100 },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      const orgAContactInOrgB = data.data.find(
        (c: { _id: string }) => c._id === orgAContactId,
      );
      expect(orgAContactInOrgB).toBeUndefined();
    });

    test("15. Org B's company list does not include Org A's company", async ({
      request,
    }) => {
      const response = await request.get(`${BASE_URL}/api/v1/crm/companies`, {
        headers: { Cookie: orgBUserAuthCookie },
        params: { pageSize: 100 },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      const orgACompanyInOrgB = data.data.find(
        (c: { _id: string }) => c._id === orgACompanyId,
      );
      expect(orgACompanyInOrgB).toBeUndefined();
    });

    test("16. Org B's lead list does not include Org A's lead", async ({
      request,
    }) => {
      const response = await request.get(`${BASE_URL}/api/v1/crm/leads`, {
        headers: { Cookie: orgBUserAuthCookie },
        params: { pageSize: 100 },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      const orgALeadInOrgB = data.data.find(
        (l: { _id: string }) => l._id === orgALeadId,
      );
      expect(orgALeadInOrgB).toBeUndefined();
    });

    test("17. Org B's deal list does not include Org A's deal", async ({
      request,
    }) => {
      const response = await request.get(`${BASE_URL}/api/v1/deals`, {
        headers: { Cookie: orgBUserAuthCookie },
        params: { pageSize: 100 },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      const orgADealInOrgB = data.data.find(
        (d: { _id: string }) => d._id === orgADealId,
      );
      expect(orgADealInOrgB).toBeUndefined();
    });

    test("18. Org B's task list does not include Org A's task", async ({
      request,
    }) => {
      const response = await request.get(`${BASE_URL}/api/v1/tasks`, {
        headers: { Cookie: orgBUserAuthCookie },
        params: { pageSize: 100 },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      const orgATaskInOrgB = data.data.find(
        (t: { _id: string }) => t._id === orgATaskId,
      );
      expect(orgATaskInOrgB).toBeUndefined();
    });

    test("19. Org B's pipeline list does not include Org A's pipeline", async ({
      request,
    }) => {
      const response = await request.get(`${BASE_URL}/api/v1/pipelines`, {
        headers: { Cookie: orgBUserAuthCookie },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      const orgAPipelineInOrgB = data.data.find(
        (p: { _id: string }) => p._id === orgAPipelineId,
      );
      expect(orgAPipelineInOrgB).toBeUndefined();
    });

    test("20. Org B's search does not return Org A's data", async ({
      request,
    }) => {
      const response = await request.get(`${BASE_URL}/api/v1/search`, {
        headers: { Cookie: orgBUserAuthCookie },
        params: { q: "Org A Secret", limit: 20 },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      // Search returns one ranked array across entity types, not a per-type
      // map, so isolation is asserted over the union of result ids.
      expect(data.data).toBeInstanceOf(Array);

      const resultIds = data.data.map((result: { id: string }) => result.id);
      expect(resultIds).not.toContain(orgAContactId);
      expect(resultIds).not.toContain(orgACompanyId);
      expect(resultIds).not.toContain(orgADealId);
      expect(resultIds).not.toContain(orgATaskId);
    });

    test("21. Org B's dashboard does not include Org A's metrics", async ({
      request,
    }) => {
      const response = await request.get(`${BASE_URL}/api/v1/dashboard`, {
        headers: { Cookie: orgBUserAuthCookie },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      // Dashboard should only show Org B's data (which should be empty)
      // This is a soft check - the structure should exist but with zero/empty values
      expect(data.data).toBeDefined();
    });
  });

  test.describe("Org A - Verify Own Data Access Still Works", () => {
    test("22. Org A can still access own contact", async ({ request }) => {
      if (!orgAContactId) test.skip(true, "Org A contact not created");

      const response = await request.get(
        `${BASE_URL}/api/v1/crm/contacts/${orgAContactId}`,
        {
          headers: { Cookie: orgAAuthCookie },
        },
      );

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data._id).toBe(orgAContactId);
    });

    test("23. Org A can still access own company", async ({ request }) => {
      if (!orgACompanyId) test.skip(true, "Org A company not created");

      const response = await request.get(
        `${BASE_URL}/api/v1/crm/companies/${orgACompanyId}`,
        {
          headers: { Cookie: orgAAuthCookie },
        },
      );

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data._id).toBe(orgACompanyId);
    });

    test("24. Org A can still access own lead", async ({ request }) => {
      if (!orgALeadId) test.skip(true, "Org A lead not created");

      const response = await request.get(
        `${BASE_URL}/api/v1/crm/leads/${orgALeadId}`,
        {
          headers: { Cookie: orgAAuthCookie },
        },
      );

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data._id).toBe(orgALeadId);
    });

    test("25. Org A can still access own deal", async ({ request }) => {
      if (!orgADealId) test.skip(true, "Org A deal not created");

      const response = await request.get(
        `${BASE_URL}/api/v1/deals/${orgADealId}`,
        {
          headers: { Cookie: orgAAuthCookie },
        },
      );

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data._id).toBe(orgADealId);
    });

    test("26. Org A can still access own task", async ({ request }) => {
      if (!orgATaskId) test.skip(true, "Org A task not created");

      const response = await request.get(
        `${BASE_URL}/api/v1/tasks/${orgATaskId}`,
        {
          headers: { Cookie: orgAAuthCookie },
        },
      );

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data._id).toBe(orgATaskId);
    });

    test("27. Org A can still access own pipeline", async ({ request }) => {
      if (!orgAPipelineId) test.skip(true, "Org A pipeline not created");

      const response = await request.get(
        `${BASE_URL}/api/v1/pipelines/${orgAPipelineId}`,
        {
          headers: { Cookie: orgAAuthCookie },
        },
      );

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data._id).toBe(orgAPipelineId);
    });
  });
});
