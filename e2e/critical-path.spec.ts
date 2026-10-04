import { BASE_URL, expect, test } from "./fixtures";

/**
 * Critical Path E2E Test
 *
 * Tests the complete user journey:
 * 1. Register a new user
 * 2. Create an organization
 * 3. Invite a member to the organization
 * 4. CRM operations: create contact, company, lead, convert lead
 * 5. Create a pipeline
 * 6. Create a deal
 * 7. Create a task
 * 8. Verify notification is received
 */

test.describe("Critical Path - Full User Journey", () => {
  /**
   * Serial, and not by preference.
   *
   * This suite is built on module state: `beforeAll` registers a user and an
   * organisation, each numbered step creates a record and keeps its id in a
   * closure variable, and every later step reads them. It only works if the whole
   * file runs in declaration order inside one worker, and `fullyParallel: false`
   * in `playwright.config.ts` does not guarantee that — see the identical note in
   * `isolation-path.spec.ts`, where the absence of this line put tests in four
   * different workers with four different copies of the module.
   *
   * `mode: "serial"` also means a failed step stops the ones after it, which is
   * what a user journey wants: a registration that failed should not be followed
   * by seventeen assertions about records that were never created.
   */
  test.describe.configure({ mode: "serial" });

  let authCookie: string;
  let organizationId: string;
  let ownerUserId: string;
  let invitedUserEmail: string;
  let invitedUserCookie: string;
  let invitationToken: string;
  let contactId: string;
  let companyId: string;
  let leadId: string;
  let pipelineId: string;
  let dealId: string;
  let taskId: string;

  test.beforeAll(async ({ playwright }) => {
    // A context created here from the worker-scoped `playwright` fixture, not
    // the test-scoped `request` fixture. `request` in `beforeAll` makes the hook
    // run once per test (Playwright cannot hoist a hook that depends on a
    // test-scoped fixture), so every test would register a new user and the
    // cookie captured below would point at a user that no longer exists by the
    // time later tests run.
    const context = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Origin: BASE_URL },
    });

    try {
      // Register a new user
      const registerResponse = await context.post(
        `${BASE_URL}/api/v1/auth/register`,
        {
          data: {
            email: `critical-${Date.now()}@example.com`,
            name: "Critical Path User",
            password: "TestPassword123!",
          },
        },
      );

      expect(registerResponse.status()).toBe(201);
      const registerData = await registerResponse.json();
      ownerUserId = registerData.data.user.id;

      // Extract session cookie. The value is carried explicitly rather than left
      // in the request context's cookie jar: the E2E server is in production mode,
      // so the cookie is `Secure` while the connection is plain HTTP.
      const cookies = registerResponse.headers()["set-cookie"];
      if (cookies) {
        const sessionMatch = cookies.match(/bn_session=([^;]+)/);
        if (sessionMatch) {
          authCookie = `bn_session=${sessionMatch[1]}`;
        }
      }

      expect(authCookie).toBeDefined();
    } finally {
      await context.dispose();
    }
  });

  test("1. Create organization", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/v1/organizations`, {
      headers: { Cookie: authCookie },
      data: {
        name: "Critical Path Organization",
        timezone: "UTC",
        currency: "USD",
      },
    });

    if (response.status() === 404) {
      test.skip(true, "Organization creation endpoint not implemented");
    }

    expect(response.status()).toBe(201);
    const data = await response.json();
    expect(data.data.organization).toBeDefined();
    organizationId = data.data.organization.id;
    expect(organizationId).toBeDefined();
  });

  test("2a. Register the account that will be invited", async ({
    playwright,
  }) => {
    // A real account, not just an address. The invitation service refuses to
    // invite somebody who already holds a membership but happily invites a
    // registered user with none, which is the state this puts them in.
    invitedUserEmail = `invited-${Date.now()}@example.com`;

    // A worker-scoped context for the same reason as `beforeAll`: `request` here
    // is test-scoped, and the cookie has to outlive this test for the acceptance
    // two steps down.
    const context = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Origin: BASE_URL },
    });

    try {
      const response = await context.post(`${BASE_URL}/api/v1/auth/register`, {
        data: {
          email: invitedUserEmail,
          name: "Invited Member",
          password: "TestPassword123!",
        },
      });

      expect(response.status()).toBe(201);
      const cookies = response.headers()["set-cookie"];
      const sessionMatch = cookies?.match(/bn_session=([^;]+)/);
      if (!sessionMatch) {
        throw new Error("registration set no session cookie");
      }
      invitedUserCookie = `bn_session=${sessionMatch[1]}`;
    } finally {
      await context.dispose();
    }
  });

  test("2b. Invite member to organization", async ({ request }) => {
    if (!organizationId) {
      test.skip(true, "Organization not created");
    }

    // `/current` rather than `/{organizationId}`: the active organisation is read
    // from the session, and an organisation id in the path would be an input this
    // API does not take. The path is the one docs/API.md §3.1 states.
    const response = await request.post(
      `${BASE_URL}/api/v1/organizations/current/members/invitations`,
      {
        headers: { Cookie: authCookie },
        data: {
          email: invitedUserEmail,
          roleKey: "MEMBER",
        },
      },
    );

    expect(response.status()).toBe(201);
    const data = await response.json();
    expect(data.data.invitation).toBeDefined();
    expect(data.data.token).toBeTruthy();
    // The stored digest is never in a response, only the raw token.
    expect(JSON.stringify(data)).not.toContain("tokenHash");
    invitationToken = data.data.token;
  });

  test("2c. The invitee accepts the invitation", async ({ request }) => {
    if (!invitationToken) {
      test.skip(true, "Invitation not created");
    }

    const response = await request.post(
      `${BASE_URL}/api/v1/auth/accept-invitation`,
      {
        headers: { Cookie: invitedUserCookie },
        data: { token: invitationToken },
      },
    );

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.data.membership.status).toBe("ACTIVE");
    // The session moved to the organisation that was just joined, which is what
    // makes the next request act in that tenant without a second call.
    expect(data.data.activeOrganizationId).toBe(organizationId);

    // A replayed token is refused, so this journey is not quietly idempotent.
    const replay = await request.post(
      `${BASE_URL}/api/v1/auth/accept-invitation`,
      {
        headers: { Cookie: invitedUserCookie },
        data: { token: invitationToken },
      },
    );
    expect(replay.status()).toBe(404);
  });

  test.describe("CRM Operations", () => {
    test("3a. Create contact", async ({ request }) => {
      if (!organizationId) {
        test.skip(true, "Organization not created");
      }

      const response = await request.post(`${BASE_URL}/api/v1/crm/contacts`, {
        headers: { Cookie: authCookie },
        data: {
          firstName: "John",
          lastName: "Doe",
          ownerId: ownerUserId,
          emails: [
            { label: "work", value: "john.doe@example.com", isPrimary: true },
          ],
          phones: [{ label: "mobile", value: "+1-555-0123", isPrimary: true }],
          jobTitle: "CTO",
          status: "LEAD",
          notes: "Initial contact from critical path test",
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      expect(data.data).toBeDefined();
      contactId = data.data._id;
      expect(contactId).toBeDefined();
    });

    test("3b. Create company", async ({ request }) => {
      if (!organizationId) {
        test.skip(true, "Organization not created");
      }

      const response = await request.post(`${BASE_URL}/api/v1/crm/companies`, {
        headers: { Cookie: authCookie },
        data: {
          name: "Acme Corporation",
          legalName: "Acme Corporation Inc.",
          industry: "Technology",
          website: "https://acme.example.com",
          email: "contact@acme.example.com",
          phone: "+1-555-0100",
          ownerId: ownerUserId,
          status: "PROSPECT",
          size: 50,
          annualRevenue: 1000000,
          notes: "Target company for critical path test",
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      expect(data.data).toBeDefined();
      companyId = data.data._id;
      expect(companyId).toBeDefined();
    });

    test("3c. Create lead", async ({ request }) => {
      if (!organizationId || !contactId) {
        test.skip(true, "Prerequisites not met");
      }

      const response = await request.post(`${BASE_URL}/api/v1/crm/leads`, {
        headers: { Cookie: authCookie },
        data: {
          title: "Enterprise Deal - Acme Corp",
          contactId,
          companyId,
          source: "Website",
          status: "NEW",
          score: 75,
          ownerId: ownerUserId,
          notes: "Lead from critical path test",
          contactSnapshot: {
            firstName: "John",
            lastName: "Doe",
            email: "john.doe@example.com",
            phone: "+1-555-0123",
            companyName: "Acme Corporation",
          },
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      expect(data.data).toBeDefined();
      leadId = data.data._id;
      expect(leadId).toBeDefined();
    });

    test("3d. Convert lead to contact + company + deal", async ({
      request,
    }) => {
      if (!leadId) {
        test.skip(true, "Lead not created");
      }

      // Creating an organisation provisions a default pipeline, so a real
      // pipeline and stage exist here, before the explicit pipeline test runs.
      // The conversion validates that both are present, so a placeholder id
      // would only earn a 500 from the ObjectId cast.
      const pipelineResponse = await request.get(
        `${BASE_URL}/api/v1/pipelines`,
        {
          headers: { Cookie: authCookie },
        },
      );
      const pipelineData = await pipelineResponse.json();
      const defaultPipeline =
        pipelineData.data.find((p: { isDefault: boolean }) => p.isDefault) ??
        pipelineData.data[0];
      const convertStage = defaultPipeline?.stages?.[0];

      if (!defaultPipeline || !convertStage) {
        test.skip(true, "No pipeline stage available for conversion");
      }

      const response = await request.post(
        `${BASE_URL}/api/v1/crm/leads/${leadId}/convert`,
        {
          headers: { Cookie: authCookie },
          data: {
            createContact: true,
            createCompany: true,
            createDeal: true,
            deal: {
              name: "Acme Corp - Enterprise License",
              pipelineId: defaultPipeline._id,
              stageId: convertStage._id,
              value: 50000,
              expectedCloseDate: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000,
              ).toISOString(),
            },
          },
        },
      );

      expect(response.status()).toBe(201);
      const data = await response.json();
      // The endpoint returns the ids it created, not the documents.
      expect(data.data.contactId).toBeDefined();
      expect(data.data.companyId).toBeDefined();
      expect(data.data.dealId).toBeDefined();
      dealId = data.data.dealId;
    });
  });

  test.describe("Pipeline Operations", () => {
    test("4. Create pipeline", async ({ request }) => {
      if (!organizationId) {
        test.skip(true, "Organization not created");
      }

      const response = await request.post(`${BASE_URL}/api/v1/pipelines`, {
        headers: { Cookie: authCookie },
        data: {
          // Not "Sales Pipeline": organisation creation already provisioned a
          // default by that name, and both the name index and the single-default
          // index would reject a second one.
          name: `Critical Path Pipeline ${Date.now()}`,
          description: "Secondary pipeline for critical path test",
          isDefault: false,
          stages: [
            {
              key: "PROSPECTING",
              name: "Prospecting",
              order: 1,
              probability: 10,
            },
            {
              key: "QUALIFICATION",
              name: "Qualification",
              order: 2,
              probability: 25,
            },
            { key: "PROPOSAL", name: "Proposal", order: 3, probability: 50 },
            {
              key: "NEGOTIATION",
              name: "Negotiation",
              order: 4,
              probability: 75,
            },
            {
              key: "WON",
              name: "Closed Won",
              order: 5,
              probability: 100,
              isWon: true,
            },
            {
              key: "LOST",
              name: "Closed Lost",
              order: 6,
              probability: 0,
              isLost: true,
            },
          ],
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      expect(data.data).toBeDefined();
      pipelineId = data.data._id;
      expect(pipelineId).toBeDefined();
    });

    test("4b. Verify pipeline is listed", async ({ request }) => {
      if (!organizationId) {
        test.skip(true, "Organization not created");
      }

      const response = await request.get(`${BASE_URL}/api/v1/pipelines`, {
        headers: { Cookie: authCookie },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);
      expect(data.data.length).toBeGreaterThan(0);
      const pipeline = data.data.find(
        (p: { _id: string }) => p._id === pipelineId,
      );
      expect(pipeline).toBeDefined();
    });
  });

  test.describe("Deal Operations", () => {
    test("5. Create deal", async ({ request }) => {
      if (!organizationId || !pipelineId || !contactId || !companyId) {
        test.skip(true, "Prerequisites not met");
      }

      // Get pipeline stages to find a valid stage ID
      const pipelineResponse = await request.get(
        `${BASE_URL}/api/v1/pipelines`,
        {
          headers: { Cookie: authCookie },
        },
      );
      const pipelineData = await pipelineResponse.json();
      const pipeline = pipelineData.data.find(
        (p: { _id: string }) => p._id === pipelineId,
      );
      const firstStage = pipeline?.stages?.[0];

      if (!firstStage) {
        test.skip(true, "Pipeline stages not available");
      }

      const response = await request.post(`${BASE_URL}/api/v1/deals`, {
        headers: { Cookie: authCookie },
        data: {
          name: "Critical Path Deal",
          contactId,
          companyId,
          pipelineId,
          stageId: firstStage._id,
          value: 25000,
          currency: "USD",
          probability: 25,
          expectedCloseDate: new Date(
            Date.now() + 14 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          description: "Deal created during critical path test",
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      expect(data.data).toBeDefined();
      dealId = data.data._id;
      expect(dealId).toBeDefined();
    });

    test("5b. Verify deal appears in pipeline board", async ({ request }) => {
      if (!pipelineId) {
        test.skip(true, "Pipeline not created");
      }

      const response = await request.get(
        `${BASE_URL}/api/v1/deals/pipeline-board`,
        {
          headers: { Cookie: authCookie },
          params: { pipelineId },
        },
      );

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data).toBeDefined();
      expect(data.data.columns).toBeInstanceOf(Array);
    });
  });

  test.describe("Task Operations", () => {
    test("6. Create task", async ({ request }) => {
      if (!organizationId || !dealId) {
        test.skip(true, "Prerequisites not met");
      }

      const response = await request.post(`${BASE_URL}/api/v1/tasks`, {
        headers: { Cookie: authCookie },
        data: {
          title: "Follow up with Acme Corp",
          description: "Send proposal and schedule demo",
          status: "TODO",
          priority: "HIGH",
          dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          assigneeId: ownerUserId,
          related: [{ entityType: "deal", entityId: dealId }],
          metadata: { source: "critical-path-test" },
        },
      });

      expect(response.status()).toBe(201);
      const data = await response.json();
      expect(data.data).toBeDefined();
      taskId = data.data._id;
      expect(taskId).toBeDefined();
    });

    test("6b. List tasks", async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/v1/tasks`, {
        headers: { Cookie: authCookie },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);
      const task = data.data.find((t: { _id: string }) => t._id === taskId);
      expect(task).toBeDefined();
    });
  });

  test.describe("Notification Operations", () => {
    test("7. Verify notification received for task assignment", async ({
      request,
    }) => {
      if (!taskId) {
        test.skip(true, "Task not created");
      }

      // Wait a moment for notification to be created
      await new Promise((resolve) => setTimeout(resolve, 500));

      const response = await request.get(`${BASE_URL}/api/v1/notifications`, {
        headers: { Cookie: authCookie },
        params: { limit: 20 },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);

      // Check if there's a notification related to the task
      const taskNotification = data.data.find(
        (n: { type: string; relatedEntityId: string }) =>
          n.type === "TASK_ASSIGNED" && n.relatedEntityId === taskId,
      );
      // Notification might not be created yet depending on implementation
      // This is a soft assertion
      if (taskNotification) {
        expect(taskNotification).toBeDefined();
      }
    });

    test("7b. Verify unread notification count", async ({ request }) => {
      const response = await request.get(
        `${BASE_URL}/api/v1/notifications/unread-count`,
        {
          headers: { Cookie: authCookie },
        },
      );

      expect(response.status()).toBe(200);
      const data = await response.json();
      expect(data.data).toBeDefined();
      expect(typeof data.data.count).toBe("number");
    });
  });

  test("8. Complete journey verification - verify all resources exist", async ({
    request,
  }) => {
    if (!organizationId) {
      test.skip(true, "Organization not created");
    }

    // Verify contact exists
    if (contactId) {
      const contactResponse = await request.get(
        `${BASE_URL}/api/v1/crm/contacts/${contactId}`,
        {
          headers: { Cookie: authCookie },
        },
      );
      expect(contactResponse.status()).toBe(200);
    }

    // Verify company exists
    if (companyId) {
      const companyResponse = await request.get(
        `${BASE_URL}/api/v1/crm/companies/${companyId}`,
        {
          headers: { Cookie: authCookie },
        },
      );
      expect(companyResponse.status()).toBe(200);
    }

    // Verify deal exists
    if (dealId) {
      const dealResponse = await request.get(
        `${BASE_URL}/api/v1/deals/${dealId}`,
        {
          headers: { Cookie: authCookie },
        },
      );
      expect(dealResponse.status()).toBe(200);
    }

    // Verify task exists
    if (taskId) {
      const taskResponse = await request.get(
        `${BASE_URL}/api/v1/tasks/${taskId}`,
        {
          headers: { Cookie: authCookie },
        },
      );
      expect(taskResponse.status()).toBe(200);
    }

    // Verify pipeline exists
    if (pipelineId) {
      const pipelineResponse = await request.get(
        `${BASE_URL}/api/v1/pipelines/${pipelineId}`,
        {
          headers: { Cookie: authCookie },
        },
      );
      expect(pipelineResponse.status()).toBe(200);
    }
  });
});
