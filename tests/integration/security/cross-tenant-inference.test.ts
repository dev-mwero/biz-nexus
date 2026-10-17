import { seedWorld, type TenantWorld } from "@tests/support/tenant-sweep";
import type { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as activitiesFeedGet } from "@/app/api/v1/activities/feed/route";
import { GET as dashboardGet } from "@/app/api/v1/dashboard/route";
import { GET as pipelineBoardGet } from "@/app/api/v1/deals/pipeline-board/route";
import { GET as dealsSummaryGet } from "@/app/api/v1/deals/summary/route";
import { GET as unreadCountGet } from "@/app/api/v1/notifications/unread-count/route";
import { connectToDatabase, disconnectDatabase } from "@/db/connection";
import { ActivityModel } from "@/modules/activities";
import { CompanyModel, ContactModel, LeadModel, TagModel } from "@/modules/crm";
import { FieldDefinitionModel } from "@/modules/crm/field-definition.model";
import { SavedViewModel } from "@/modules/crm/saved-view.model";
import { DealModel } from "@/modules/deals";
import { UserModel } from "@/modules/identity";
import { SessionModel } from "@/modules/identity/session.model";
import { NotificationModel } from "@/modules/notifications";
import {
  InvitationModel,
  MembershipModel,
  OrganizationModel,
  RoleModel,
} from "@/modules/organizations";
import { PipelineModel } from "@/modules/pipelines";
import { TaskModel } from "@/modules/tasks";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * Cross-tenant *inference*: an aggregate must not answer a question about the
 * other tenant.
 *
 * The 404 sweep proves a route refuses a foreign *id*. It says nothing about a
 * route with no id in its path, and those are the ones that can leak without
 * ever naming a record: a dashboard sums, a summary counts, a feed lists, an
 * unread badge tallies, a board groups. A single missing `organizationId` in
 * one `$match` turns any of them into an oracle — the caller cannot read the
 * other tenant's document, but they can read how many there are, and a count is
 * often the whole secret.
 *
 * The caller is the same one the 404 sweep uses: Owner of *both* organisations
 * holding every permission, so a permission check cannot be what withholds the
 * numbers. The difference between the two calls in each test is only which
 * organisation the session is active in — Acme carries a populated tenant,
 * Globex is empty — so anything non-zero while active in Globex came from Acme.
 *
 * Every "it is zero" assertion is paired with a control that flips the session
 * back to Acme and asserts the same endpoint reports the seeded numbers. A
 * route that returns zero to everyone — the other way to pass the negative half
 * — fails that control, so the pair cannot both hold unless the scope is real.
 */

const ORIGIN = "http://localhost:3000";

/** The population seeded into Acme, and the numbers the controls assert. */
const ACME_LEADS = 2;
const ACME_LEADS_CONVERTED = 1;
const ACME_OVERDUE_TASKS = 3;
const ACME_ACTIVITIES = 5;
const ACME_NOTIFICATIONS = 4;
const ACME_OPEN_DEALS = 3;

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

let world: TenantWorld;
let acmePipelineId: Types.ObjectId;
let acmeStageId: Types.ObjectId;

async function clearAll(): Promise<void> {
  await Promise.all([
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    OrganizationModel.deleteMany({}),
    RoleModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    InvitationModel.deleteMany({}),
    CompanyModel.deleteMany({}),
    ContactModel.deleteMany({}),
    LeadModel.deleteMany({}),
    TagModel.deleteMany({}),
    SavedViewModel.deleteMany({}),
    FieldDefinitionModel.deleteMany({}),
    DealModel.deleteMany({}),
    PipelineModel.deleteMany({}),
    TaskModel.deleteMany({}),
    ActivityModel.deleteMany({}),
    NotificationModel.deleteMany({}),
  ]);
}

async function makePipeline(
  org: Types.ObjectId,
  name: string,
  isDefault: boolean,
) {
  return PipelineModel.create({
    organizationId: org,
    name,
    isDefault,
    order: 0,
    stages: [
      {
        key: "NEW",
        name: "New",
        order: 0,
        probability: 0,
        color: "blue",
        isWon: false,
        isLost: false,
      },
    ],
    createdBy: world.userId,
    updatedBy: world.userId,
  });
}

/**
 * Populate Acme, and give Globex the one thing it needs to be asked.
 *
 * Globex needs a default pipeline because the dashboard refuses to serve an
 * organisation without one; without it the endpoint would answer 404 and the
 * "no numbers" assertion would pass on the refusal rather than on the scope.
 * Globex gets a pipeline and nothing else, so every count it reports must be a
 * zero it computed, not a record it owns.
 */
async function populate(): Promise<void> {
  await makePipeline(world.globex, "Globex Default", true);

  const acme = await makePipeline(world.acme, "Acme Default", true);
  acmePipelineId = acme._id;
  const stageId = acme.stages[0]?._id;
  if (!stageId) throw new Error("the acme fixture pipeline has no stage");
  acmeStageId = stageId;

  const lead = {
    contactSnapshot: {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
    },
    source: "Website",
    ownerId: world.userId,
    createdBy: world.userId,
    updatedBy: world.userId,
  };
  await LeadModel.create([
    {
      ...lead,
      organizationId: world.acme,
      title: "Converted",
      status: "CONVERTED",
    },
    { ...lead, organizationId: world.acme, title: "Open", status: "NEW" },
  ]);

  const overdue = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await TaskModel.create(
    Array.from({ length: ACME_OVERDUE_TASKS }, (_, i) => ({
      organizationId: world.acme,
      title: `Overdue ${i}`,
      status: "TODO" as const,
      priority: "HIGH" as const,
      dueAt: overdue,
      createdBy: world.userId,
      updatedBy: world.userId,
    })),
  );

  await ActivityModel.create(
    Array.from({ length: ACME_ACTIVITIES }, (_, i) => ({
      organizationId: world.acme,
      type: "NOTE" as const,
      title: `Activity ${i}`,
      occurredAt: new Date(Date.now() - i * 60 * 60 * 1000),
      actorId: world.userId,
      ownerId: world.userId,
      subjects: [],
      metadata: {},
    })),
  );

  await NotificationModel.create(
    Array.from({ length: ACME_NOTIFICATIONS }, (_, i) => ({
      organizationId: world.acme,
      userId: world.userId,
      type: "SYSTEM" as const,
      channel: "IN_APP" as const,
      title: `Notification ${i}`,
      body: "And you should know",
      data: {},
    })),
  );

  await DealModel.create(
    Array.from({ length: ACME_OPEN_DEALS }, (_, i) => ({
      organizationId: world.acme,
      name: `Open Deal ${i}`,
      pipelineId: acmePipelineId,
      stageId: acmeStageId,
      ownerId: world.userId,
      value: 1000,
      currency: "USD",
      probability: 0,
      status: "OPEN" as const,
      sortOrder: i,
      tags: [],
      customFields: {},
      createdBy: world.userId,
      updatedBy: world.userId,
    })),
  );
}

beforeEach(async () => {
  await clearAll();
  world = await seedWorld();
  await populate();
});

function request(path: string): Request {
  const headers = new Headers({ origin: ORIGIN });
  headers.set("cookie", `${SESSION_COOKIE}=${world.token}`);
  return new Request(new URL(path, ORIGIN), { headers });
}

/**
 * Change the session's active organisation. The guard re-reads the session from
 * the database on every request (`verifySessionToken`), so this takes effect on
 * the next call with no new token and no new cookie.
 */
async function activate(org: Types.ObjectId): Promise<void> {
  await SessionModel.updateMany(
    { userId: world.userId },
    { $set: { activeOrganizationId: org } },
  );
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("cross-tenant inference", () => {
  describe("GET /dashboard", () => {
    it("reports zeros for an empty organisation, not the populated tenant's metrics", async () => {
      await activate(world.globex);

      const response = await dashboardGet(request("/api/v1/dashboard"));
      expect(response.status).toBe(200);

      const data = (await json(response)).data as {
        metricCards: Record<string, number>;
        pipelineSummary: unknown[];
        overdueTasks: number;
        recentActivity: unknown[];
      };

      // The facets that only filter by organisation — leads, tasks, activities
      // — are the leak surface: they would inherit Acme's rows if a union
      // branch dropped its `$match`. Acme has 3 overdue tasks, 5 activities and
      // 2 leads seeded, and none of them may be visible here.
      expect(data.overdueTasks).toBe(0);
      expect(data.recentActivity).toHaveLength(0);
      expect(data.metricCards.leadConversionRate).toBe(0);
      expect(data.metricCards.pipelineValue).toBe(0);
      expect(data.metricCards.dealsWonThisMonth).toBe(0);
      expect(data.metricCards.winRate).toBe(0);
      expect(data.pipelineSummary).toHaveLength(0);
    });

    it("reports the populated tenant's own metrics when active in it", async () => {
      // The control. Without it, a route that answered zero to everyone would
      // pass the assertion above, and "it hides the other tenant" would be
      // indistinguishable from "it hides everything".
      await activate(world.acme);

      const response = await dashboardGet(request("/api/v1/dashboard"));
      expect(response.status).toBe(200);

      const data = (await json(response)).data as {
        metricCards: Record<string, number>;
        overdueTasks: number;
        recentActivity: unknown[];
      };

      expect(data.overdueTasks).toBe(ACME_OVERDUE_TASKS);
      expect(data.recentActivity).toHaveLength(ACME_ACTIVITIES);
      expect(data.metricCards.leadConversionRate).toBe(
        (ACME_LEADS_CONVERTED / ACME_LEADS) * 100,
      );
    });
  });

  describe("GET /deals/summary", () => {
    it("counts only the active organisation's open deals", async () => {
      await activate(world.globex);

      const response = await dealsSummaryGet(request("/api/v1/deals/summary"));
      expect(response.status).toBe(200);

      const data = (await json(response)).data as {
        openDealsCount: number;
        totalOpenValue: number;
      };

      expect(data.openDealsCount).toBe(0);
      expect(data.totalOpenValue).toBe(0);
    });

    it("counts the populated tenant's own open deals when active in it", async () => {
      await activate(world.acme);

      const response = await dealsSummaryGet(request("/api/v1/deals/summary"));
      expect(response.status).toBe(200);

      const data = (await json(response)).data as {
        openDealsCount: number;
        totalOpenValue: number;
      };

      expect(data.openDealsCount).toBe(ACME_OPEN_DEALS);
      expect(data.totalOpenValue).toBe(ACME_OPEN_DEALS * 1000);
    });
  });

  describe("GET /notifications/unread-count", () => {
    it("tallies only the active organisation's notifications", async () => {
      await activate(world.globex);

      const response = await unreadCountGet(
        request("/api/v1/notifications/unread-count"),
      );
      expect(response.status).toBe(200);

      const data = (await json(response)).data as { count: number };
      expect(data.count).toBe(0);
    });

    it("tallies the populated tenant's own notifications when active in it", async () => {
      await activate(world.acme);

      const response = await unreadCountGet(
        request("/api/v1/notifications/unread-count"),
      );
      expect(response.status).toBe(200);

      const data = (await json(response)).data as { count: number };
      expect(data.count).toBe(ACME_NOTIFICATIONS);
    });
  });

  describe("GET /activities/feed", () => {
    it("lists only the active organisation's activity", async () => {
      await activate(world.globex);

      const response = await activitiesFeedGet(
        request("/api/v1/activities/feed"),
      );
      expect(response.status).toBe(200);

      const data = (await json(response)).data as { activities: unknown[] };
      expect(data.activities).toHaveLength(0);
    });

    it("lists the populated tenant's own activity when active in it", async () => {
      await activate(world.acme);

      const response = await activitiesFeedGet(
        request("/api/v1/activities/feed"),
      );
      expect(response.status).toBe(200);

      const data = (await json(response)).data as { activities: unknown[] };
      expect(data.activities).toHaveLength(ACME_ACTIVITIES);
    });
  });

  describe("GET /deals/pipeline-board", () => {
    it("refuses another organisation's pipeline id with 404", async () => {
      // A board takes a pipeline id but is not a `[id]` route, so the 404 sweep
      // does not see it. Handed the other tenant's pipeline, it must resolve it
      // through the same scope and find nothing.
      await activate(world.globex);

      const response = await pipelineBoardGet(
        request(`/api/v1/deals/pipeline-board?pipelineId=${acmePipelineId}`),
      );

      expect(response.status).toBe(404);
    });

    it("returns the caller's own board, so the refusal is not unconditional", async () => {
      await activate(world.acme);

      const response = await pipelineBoardGet(
        request(`/api/v1/deals/pipeline-board?pipelineId=${acmePipelineId}`),
      );

      expect(response.status).toBe(200);
      const data = (await json(response)).data as {
        columns: { deals: unknown[] }[];
      };
      const deals = data.columns.flatMap((column) => column.deals);
      expect(deals).toHaveLength(ACME_OPEN_DEALS);
    });
  });
});
