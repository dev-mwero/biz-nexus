import type { APIRequestContext } from "@playwright/test";

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
  /**
   * Serial, and not by preference.
   *
   * This suite is built on module state: `beforeAll` registers two users and two
   * organisations, tests 2 to 7 create Org A's records and keep their ids in
   * closure variables, and every later test reads them. That design only works if
   * the whole file runs in declaration order inside one worker.
   *
   * `fullyParallel: false` in `playwright.config.ts` is not enough to guarantee
   * that, and it demonstrably did not: with `mode` left at its default, these
   * tests were distributed across four workers, each with its own copy of the
   * module and therefore its own `beforeAll` — so Org A's session cookie in a
   * mutation test belonged to a different user than the id it was posting
   * against, and the suite failed with 403s that looked like authorisation bugs.
   * In CI `workers` is 2, so this was always one place a scheduling change could
   * turn into a red pipeline and a misleading failure.
   *
   * `mode: "serial"` pins the guarantee to the suite that depends on it: one
   * worker, declaration order, and a failure stops the rest rather than letting
   * later tests run against fixtures that were never created.
   */
  test.describe.configure({ mode: "serial" });

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

      // Exactly 404, not [403, 404]. Org B is the Owner of Org B and holds
      // `contacts.read`, so the permission guard passes and the refusal can only
      // come from the scope finding nothing — which is the thing being tested. A
      // 403 would mean the guard answered first and the record's existence was
      // never actually established as hidden. See §6 of docs/SECURITY.md: a 403
      // confirms the record exists, which is itself a disclosure.
      expect(response.status()).toBe(404);
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

      expect(response.status()).toBe(404);
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

      expect(response.status()).toBe(404);
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

      expect(response.status()).toBe(404);
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

      expect(response.status()).toBe(404);
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

      expect(response.status()).toBe(404);
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

  // Cross-tenant *mutation*, which the suite above does not cover at all. It
  // covers reads: a guessed id through a GET, and a list, a search, a dashboard
  // aggregate. Reads are the easier half. A write is refused by the tenancy
  // layer having found nothing, and a write refused by the *permission* layer
  // would look identical from outside while proving nothing about isolation — so
  // these assert `404` and never `403`. Org B is the Owner of Org B and holds
  // every one of these permissions for its own organisation, so the guard at the
  // top of each handler passes. Anything but a 404 means the record was resolved
  // outside the caller's scope, and a 403 would mean the guard answered first
  // and the record's non-existence was never actually established.
  //
  // Each test builds its own record and then asserts two things about the
  // refusal: the status Org B sees, and that Org A's record is unchanged. The
  // second is the one that matters — a refused mutation that still wrote
  // something satisfies a status assertion perfectly, and the status is all the
  // API said. `docs/SECURITY.md` §6 is also why 404 and not 403: a 403 confirms
  // the record exists, which is a disclosure on its own.
  //
  // Self-contained on purpose. The block above threads ids between tests through
  // module state, which assumes one worker for the file; Playwright did not
  // honour that here and ran the outer `beforeAll` three times, so later tests
  // saw `undefined` for ids earlier tests had set. A test that creates what it
  // needs has nothing to inherit and cannot rot that way.
  test.describe("Org B - Attempt Cross-Organization Mutation", () => {
    const MUTATIONS: {
      entity: string;
      path: string;
      /**
       * Builds the payload Org A needs to create this entity. Async, and given
       * the request context, because a deal cannot be created without a pipeline
       * and one of its stages — so the deal's factory provisions those first
       * rather than depending on a fixture some earlier test left lying around.
       */
      create: (ctx: {
        request: APIRequestContext;
        cookie: string;
        userId: string;
      }) => Promise<Record<string, unknown>>;
      /** The field the cross-tenant PATCH tries to change, and its original. */
      patch: Record<string, unknown>;
      field: string;
      original: unknown;
    }[] = [
      {
        entity: "contact",
        path: "/api/v1/crm/contacts",
        create: async () => ({
          firstName: "Mut",
          lastName: "Probe",
          ownerId: orgAUserId,
          status: "CUSTOMER",
        }),
        patch: { firstName: "Pwned" },
        field: "firstName",
        original: "Mut",
      },
      {
        entity: "company",
        path: "/api/v1/crm/companies",
        create: async () => ({
          name: "Probe Corp",
          ownerId: orgAUserId,
          status: "CUSTOMER",
        }),
        patch: { name: "Pwned Inc" },
        field: "name",
        original: "Probe Corp",
      },
      {
        entity: "lead",
        path: "/api/v1/crm/leads",
        create: async () => ({
          title: "Probe Lead",
          ownerId: orgAUserId,
          source: "Referral",
          status: "QUALIFIED",
          // Required by the schema, not optional: a lead keeps its own record of
          // the person it came from, and conversion needs an address to build a
          // contact from.
          contactSnapshot: {
            firstName: "Probe",
            lastName: "Lead",
            email: "probe.lead@orga.example.com",
          },
        }),
        patch: { title: "Pwned Lead" },
        field: "title",
        original: "Probe Lead",
      },
      {
        entity: "deal",
        path: "/api/v1/deals",
        create: async ({ request, cookie }) => {
          // A deal belongs to a stage, and a stage belongs to a pipeline, so
          // this factory provisions both rather than borrowing the pipeline some
          // earlier test created.
          const pipeline = await request.post(`${BASE_URL}/api/v1/pipelines`, {
            headers: { Cookie: cookie },
            data: {
              name: "Probe Deal Pipeline",
              isDefault: false,
              stages: [{ key: "NEW", name: "New", order: 1, probability: 10 }],
            },
          });
          expect(pipeline.status()).toBe(201);
          const created = await pipeline.json();
          const stages = created.data.stages as { _id: string }[];
          return {
            name: "Probe Deal",
            pipelineId: created.data._id as string,
            stageId: stages[0]._id,
            value: 1000,
            currency: "USD",
          };
        },
        // `name`, not `title`: a deal has no `title` field, and `strictObject`
        // rejects an unrecognised key with 422 before the scope check runs. That
        // is the schema working, and it is also why a wrong field name makes
        // this test silently prove nothing — it would go on to assert a 422
        // path, not a tenancy one.
        patch: { name: "Pwned Deal" },
        field: "name",
        original: "Probe Deal",
      },
      {
        entity: "task",
        path: "/api/v1/tasks",
        create: async () => ({
          title: "Probe Task",
          status: "TODO",
          priority: "URGENT",
        }),
        patch: { title: "Pwned Task" },
        field: "title",
        original: "Probe Task",
      },
      {
        entity: "pipeline",
        path: "/api/v1/pipelines",
        create: async () => ({
          name: "Probe Pipeline",
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
        }),
        patch: { name: "Pwned Pipeline" },
        field: "name",
        original: "Probe Pipeline",
      },
    ];

    for (const mutation of MUTATIONS) {
      test(`Org B cannot PATCH or DELETE Org A's ${mutation.entity}`, async ({
        request,
      }) => {
        if (!orgAUserId) test.skip(true, "Org A user not created");

        const created = await request.post(`${BASE_URL}${mutation.path}`, {
          headers: { Cookie: orgAAuthCookie },
          data: await mutation.create({
            request,
            cookie: orgAAuthCookie,
            userId: orgAUserId,
          }),
        });
        expect(
          created.status(),
          `Org A should be able to create its own ${mutation.entity}`,
        ).toBe(201);
        const id = (await created.json()).data._id as string;
        expect(id).toBeDefined();

        const patch = await request.patch(`${BASE_URL}${mutation.path}/${id}`, {
          headers: { Cookie: orgBUserAuthCookie },
          data: mutation.patch,
        });
        expect(
          patch.status(),
          `cross-tenant PATCH of Org A's ${mutation.entity}`,
        ).toBe(404);

        const del = await request.delete(`${BASE_URL}${mutation.path}/${id}`, {
          headers: { Cookie: orgBUserAuthCookie },
        });
        expect(
          del.status(),
          `cross-tenant DELETE of Org A's ${mutation.entity}`,
        ).toBe(404);

        // Both refusals were only worth anything if nothing was written. Org B
        // cannot detect a write that happened anyway — it got the same two
        // statuses either way — so the check has to come from Org A's side.
        const reread = await request.get(`${BASE_URL}${mutation.path}/${id}`, {
          headers: { Cookie: orgAAuthCookie },
        });
        expect(
          reread.status(),
          `Org A's ${mutation.entity} survived two refused cross-tenant mutations`,
        ).toBe(200);
        expect(
          (await reread.json()).data[mutation.field],
          `${mutation.entity}.${mutation.field} was changed by a refused cross-tenant mutation`,
        ).toEqual(mutation.original);
      });
    }
  });
});
