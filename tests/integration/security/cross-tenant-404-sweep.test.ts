import { ROUTE_TREE } from "@tests/support/api-route-tree";
import { seed, seedWorld, type TenantWorld } from "@tests/support/tenant-sweep";
import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as activitiesDelete } from "@/app/api/v1/activities/[id]/route";
import { GET as companyContactsGet } from "@/app/api/v1/crm/companies/[id]/contacts/route";
import { POST as companyRestorePost } from "@/app/api/v1/crm/companies/[id]/restore/route";
import {
  DELETE as companyDelete,
  GET as companyGet,
  PATCH as companyPatch,
} from "@/app/api/v1/crm/companies/[id]/route";
import { POST as contactMergePost } from "@/app/api/v1/crm/contacts/[id]/merge/route";
import { POST as contactRestorePost } from "@/app/api/v1/crm/contacts/[id]/restore/route";
import {
  DELETE as contactDelete,
  GET as contactGet,
  PATCH as contactPatch,
} from "@/app/api/v1/crm/contacts/[id]/route";
import {
  DELETE as fieldDelete,
  GET as fieldGet,
  PATCH as fieldPatch,
} from "@/app/api/v1/crm/field-definitions/[id]/route";
import { POST as leadConvertPost } from "@/app/api/v1/crm/leads/[id]/convert/route";
import { GET as leadConvertPreviewGet } from "@/app/api/v1/crm/leads/[id]/convert-preview/route";
import { POST as leadRestorePost } from "@/app/api/v1/crm/leads/[id]/restore/route";
import {
  DELETE as leadDelete,
  GET as leadGet,
  PATCH as leadPatch,
} from "@/app/api/v1/crm/leads/[id]/route";
import {
  DELETE as savedViewDelete,
  GET as savedViewGet,
  PATCH as savedViewPatch,
} from "@/app/api/v1/crm/saved-views/[id]/route";
import { POST as tagMergePost } from "@/app/api/v1/crm/tags/[id]/merge/route";
import {
  DELETE as tagDelete,
  GET as tagGet,
  PATCH as tagPatch,
} from "@/app/api/v1/crm/tags/[id]/route";
import { POST as dealLosePost } from "@/app/api/v1/deals/[id]/lose/route";
import { POST as dealMovePost } from "@/app/api/v1/deals/[id]/move/route";
import {
  DELETE as dealDelete,
  GET as dealGet,
  PATCH as dealPatch,
} from "@/app/api/v1/deals/[id]/route";
import { GET as dealTimelineGet } from "@/app/api/v1/deals/[id]/timeline/route";
import { POST as dealWinPost } from "@/app/api/v1/deals/[id]/win/route";
import { PATCH as notificationReadPatch } from "@/app/api/v1/notifications/[id]/read/route";
import { DELETE as invitationDelete } from "@/app/api/v1/organizations/current/invitations/[id]/route";
import { POST as pipelineReorderPost } from "@/app/api/v1/pipelines/[id]/reorder/route";
import {
  DELETE as pipelineDelete,
  GET as pipelineGet,
  PATCH as pipelinePatch,
} from "@/app/api/v1/pipelines/[id]/route";
import {
  DELETE as taskDelete,
  GET as taskGet,
  PATCH as taskPatch,
} from "@/app/api/v1/tasks/[id]/route";
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
 * Every dynamic route refuses another organisation's id with a 404.
 *
 * The repository layer is already proven scoped (tenant-isolation.test.ts), and
 * the guards are proven (cross-tenant-isolation.test.ts). What no test asserted
 * is the thing a client actually hits: that each of the 25 dynamic route files
 * — 43 method/path pairs — looks a record up through its tenant scope and
 * answers `404` when the id belongs to someone else. A handler that reaches for
 * the model directly, or filters in memory, or resolves the record before the
 * guard, would pass every existing suite and leak here.
 *
 * The caller is Owner of *both* organisations with every permission, and the
 * session is active in Acme. So a permission check cannot be what refuses, and
 * the only difference between the "own" and the "foreign" call is which tenant
 * the id belongs to.
 *
 * The foreign id is a *real* record, not a random one, and each case asserts
 * that a random, absent id gets the same answer. A route that answered 404 for
 * everything would pass the foreign assertion but fail its own read control
 * below; a route that distinguished "foreign" from "absent" would fail the
 * indistinguishability assertion. Together the two rules say: 404, and nothing
 * about which 404 it is.
 */

const ORIGIN = "http://localhost:3000";

type SeedKind =
  | "company"
  | "contact"
  | "lead"
  | "tag"
  | "savedView"
  | "fieldDefinition"
  | "deal"
  | "pipeline"
  | "task"
  | "activity"
  | "notification"
  | "invitation";

interface SweepCase {
  /** `METHOD /path/:id`, the key the completeness assertion compares on. */
  endpoint: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Builds the request path with a concrete id. */
  path: (id: string) => string;
  handler: (request: Request) => Promise<Response>;
  seedKind: SeedKind;
  /**
   * A valid body, for routes that read one, so the tenant lookup is reached
   * rather than a 422. Several update schemas require at least one field, so
   * `{}` is not enough — it is refused before the handler ever names the
   * record, and the case would pass on a route that never scoped its lookup.
   */
  body?: (id: string) => unknown;
  /**
   * True for side-effect-free reads: the case also seeds an own record and
   * asserts it is returned, so a handler that 404s unconditionally is caught.
   */
  readControl?: boolean;
}

const CASES: SweepCase[] = [
  {
    endpoint: "DELETE /activities/:id",
    method: "DELETE",
    path: (id) => `/api/v1/activities/${id}`,
    handler: activitiesDelete,
    seedKind: "activity",
  },
  {
    endpoint: "GET /crm/companies/:id/contacts",
    method: "GET",
    path: (id) => `/api/v1/crm/companies/${id}/contacts`,
    handler: companyContactsGet,
    seedKind: "company",
    readControl: true,
  },
  {
    endpoint: "POST /crm/companies/:id/restore",
    method: "POST",
    path: (id) => `/api/v1/crm/companies/${id}/restore`,
    handler: companyRestorePost,
    seedKind: "company",
  },
  {
    endpoint: "GET /crm/companies/:id",
    method: "GET",
    path: (id) => `/api/v1/crm/companies/${id}`,
    handler: companyGet,
    seedKind: "company",
    readControl: true,
  },
  {
    endpoint: "PATCH /crm/companies/:id",
    method: "PATCH",
    path: (id) => `/api/v1/crm/companies/${id}`,
    handler: companyPatch,
    seedKind: "company",
    body: () => ({ name: "Renamed" }),
  },
  {
    endpoint: "DELETE /crm/companies/:id",
    method: "DELETE",
    path: (id) => `/api/v1/crm/companies/${id}`,
    handler: companyDelete,
    seedKind: "company",
  },
  {
    endpoint: "POST /crm/contacts/:id/merge",
    method: "POST",
    path: (id) => `/api/v1/crm/contacts/${id}/merge`,
    handler: contactMergePost,
    seedKind: "contact",
    body: (id) => ({
      sourceContactId: id,
      targetContactId: new Types.ObjectId().toString(),
    }),
  },
  {
    endpoint: "POST /crm/contacts/:id/restore",
    method: "POST",
    path: (id) => `/api/v1/crm/contacts/${id}/restore`,
    handler: contactRestorePost,
    seedKind: "contact",
  },
  {
    endpoint: "GET /crm/contacts/:id",
    method: "GET",
    path: (id) => `/api/v1/crm/contacts/${id}`,
    handler: contactGet,
    seedKind: "contact",
    readControl: true,
  },
  {
    endpoint: "PATCH /crm/contacts/:id",
    method: "PATCH",
    path: (id) => `/api/v1/crm/contacts/${id}`,
    handler: contactPatch,
    seedKind: "contact",
    body: () => ({ firstName: "Renamed" }),
  },
  {
    endpoint: "DELETE /crm/contacts/:id",
    method: "DELETE",
    path: (id) => `/api/v1/crm/contacts/${id}`,
    handler: contactDelete,
    seedKind: "contact",
  },
  {
    endpoint: "GET /crm/field-definitions/:id",
    method: "GET",
    path: (id) => `/api/v1/crm/field-definitions/${id}`,
    handler: fieldGet,
    seedKind: "fieldDefinition",
    readControl: true,
  },
  {
    endpoint: "PATCH /crm/field-definitions/:id",
    method: "PATCH",
    path: (id) => `/api/v1/crm/field-definitions/${id}`,
    handler: fieldPatch,
    seedKind: "fieldDefinition",
    body: () => ({ label: "Renamed" }),
  },
  {
    endpoint: "DELETE /crm/field-definitions/:id",
    method: "DELETE",
    path: (id) => `/api/v1/crm/field-definitions/${id}`,
    handler: fieldDelete,
    seedKind: "fieldDefinition",
  },
  {
    endpoint: "POST /crm/leads/:id/convert",
    method: "POST",
    path: (id) => `/api/v1/crm/leads/${id}/convert`,
    handler: leadConvertPost,
    seedKind: "lead",
    body: () => ({}),
  },
  {
    endpoint: "GET /crm/leads/:id/convert-preview",
    method: "GET",
    path: (id) => `/api/v1/crm/leads/${id}/convert-preview`,
    handler: leadConvertPreviewGet,
    seedKind: "lead",
    readControl: true,
  },
  {
    endpoint: "POST /crm/leads/:id/restore",
    method: "POST",
    path: (id) => `/api/v1/crm/leads/${id}/restore`,
    handler: leadRestorePost,
    seedKind: "lead",
  },
  {
    endpoint: "GET /crm/leads/:id",
    method: "GET",
    path: (id) => `/api/v1/crm/leads/${id}`,
    handler: leadGet,
    seedKind: "lead",
    readControl: true,
  },
  {
    endpoint: "PATCH /crm/leads/:id",
    method: "PATCH",
    path: (id) => `/api/v1/crm/leads/${id}`,
    handler: leadPatch,
    seedKind: "lead",
    body: () => ({ title: "Renamed" }),
  },
  {
    endpoint: "DELETE /crm/leads/:id",
    method: "DELETE",
    path: (id) => `/api/v1/crm/leads/${id}`,
    handler: leadDelete,
    seedKind: "lead",
  },
  {
    endpoint: "GET /crm/saved-views/:id",
    method: "GET",
    path: (id) => `/api/v1/crm/saved-views/${id}`,
    handler: savedViewGet,
    seedKind: "savedView",
    readControl: true,
  },
  {
    endpoint: "PATCH /crm/saved-views/:id",
    method: "PATCH",
    path: (id) => `/api/v1/crm/saved-views/${id}`,
    handler: savedViewPatch,
    seedKind: "savedView",
    body: () => ({ name: "Renamed" }),
  },
  {
    endpoint: "DELETE /crm/saved-views/:id",
    method: "DELETE",
    path: (id) => `/api/v1/crm/saved-views/${id}`,
    handler: savedViewDelete,
    seedKind: "savedView",
  },
  {
    endpoint: "POST /crm/tags/:id/merge",
    method: "POST",
    path: (id) => `/api/v1/crm/tags/${id}/merge`,
    handler: tagMergePost,
    seedKind: "tag",
    body: (id) => ({
      sourceTagId: id,
      targetTagId: new Types.ObjectId().toString(),
    }),
  },
  {
    endpoint: "GET /crm/tags/:id",
    method: "GET",
    path: (id) => `/api/v1/crm/tags/${id}`,
    handler: tagGet,
    seedKind: "tag",
    readControl: true,
  },
  {
    endpoint: "PATCH /crm/tags/:id",
    method: "PATCH",
    path: (id) => `/api/v1/crm/tags/${id}`,
    handler: tagPatch,
    seedKind: "tag",
    body: () => ({ name: "Renamed" }),
  },
  {
    endpoint: "DELETE /crm/tags/:id",
    method: "DELETE",
    path: (id) => `/api/v1/crm/tags/${id}`,
    handler: tagDelete,
    seedKind: "tag",
  },
  {
    endpoint: "POST /deals/:id/lose",
    method: "POST",
    path: (id) => `/api/v1/deals/${id}/lose`,
    handler: dealLosePost,
    seedKind: "deal",
    body: () => ({}),
  },
  {
    endpoint: "POST /deals/:id/move",
    method: "POST",
    path: (id) => `/api/v1/deals/${id}/move`,
    handler: dealMovePost,
    seedKind: "deal",
    body: () => ({
      stageId: new Types.ObjectId().toString(),
      sortOrder: 0,
    }),
  },
  {
    endpoint: "GET /deals/:id",
    method: "GET",
    path: (id) => `/api/v1/deals/${id}`,
    handler: dealGet,
    seedKind: "deal",
    readControl: true,
  },
  {
    endpoint: "PATCH /deals/:id",
    method: "PATCH",
    path: (id) => `/api/v1/deals/${id}`,
    handler: dealPatch,
    seedKind: "deal",
    body: () => ({}),
  },
  {
    endpoint: "DELETE /deals/:id",
    method: "DELETE",
    path: (id) => `/api/v1/deals/${id}`,
    handler: dealDelete,
    seedKind: "deal",
  },
  {
    endpoint: "GET /deals/:id/timeline",
    method: "GET",
    path: (id) => `/api/v1/deals/${id}/timeline`,
    handler: dealTimelineGet,
    seedKind: "deal",
    readControl: true,
  },
  {
    endpoint: "POST /deals/:id/win",
    method: "POST",
    path: (id) => `/api/v1/deals/${id}/win`,
    handler: dealWinPost,
    seedKind: "deal",
  },
  {
    endpoint: "PATCH /notifications/:id/read",
    method: "PATCH",
    path: (id) => `/api/v1/notifications/${id}/read`,
    handler: notificationReadPatch,
    seedKind: "notification",
  },
  {
    endpoint: "DELETE /organizations/current/invitations/:id",
    method: "DELETE",
    path: (id) => `/api/v1/organizations/current/invitations/${id}`,
    handler: invitationDelete,
    seedKind: "invitation",
  },
  {
    endpoint: "POST /pipelines/:id/reorder",
    method: "POST",
    path: (id) => `/api/v1/pipelines/${id}/reorder`,
    handler: pipelineReorderPost,
    seedKind: "pipeline",
    body: () => ({ stages: [] }),
  },
  {
    endpoint: "GET /pipelines/:id",
    method: "GET",
    path: (id) => `/api/v1/pipelines/${id}`,
    handler: pipelineGet,
    seedKind: "pipeline",
    readControl: true,
  },
  {
    endpoint: "PATCH /pipelines/:id",
    method: "PATCH",
    path: (id) => `/api/v1/pipelines/${id}`,
    handler: pipelinePatch,
    seedKind: "pipeline",
    body: () => ({}),
  },
  {
    endpoint: "DELETE /pipelines/:id",
    method: "DELETE",
    path: (id) => `/api/v1/pipelines/${id}`,
    handler: pipelineDelete,
    seedKind: "pipeline",
  },
  {
    endpoint: "GET /tasks/:id",
    method: "GET",
    path: (id) => `/api/v1/tasks/${id}`,
    handler: taskGet,
    seedKind: "task",
    readControl: true,
  },
  {
    endpoint: "PATCH /tasks/:id",
    method: "PATCH",
    path: (id) => `/api/v1/tasks/${id}`,
    handler: taskPatch,
    seedKind: "task",
    body: () => ({}),
  },
  {
    endpoint: "DELETE /tasks/:id",
    method: "DELETE",
    path: (id) => `/api/v1/tasks/${id}`,
    handler: taskDelete,
    seedKind: "task",
  },
];

/** Seed one record of the named kind, in `org`, owned by `user`. */
async function seedOne(
  kind: SeedKind,
  world: TenantWorld,
  org: Types.ObjectId,
): Promise<Types.ObjectId> {
  if (kind === "invitation") {
    const roleId = org.equals(world.globex)
      ? world.globexRoleId
      : world.acmeRoleId;
    return seed.invitation(org, world.userId, roleId);
  }
  return seed[kind](org, world.userId);
}

function requestFor(c: SweepCase, id: string, token: string): Request {
  const headers = new Headers({ origin: ORIGIN });
  headers.set("cookie", `${SESSION_COOKIE}=${token}`);

  let body: string | undefined;
  if (c.body) {
    body = JSON.stringify(c.body(id));
    headers.set("content-type", "application/json");
  }

  return new Request(new URL(c.path(id), ORIGIN), {
    method: c.method,
    headers,
    body,
  });
}

async function bodyCode(response: Response): Promise<string | undefined> {
  const parsed = (await response.json()) as {
    error?: { code?: string };
  };
  return parsed.error?.code;
}

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

let world: TenantWorld;

beforeEach(async () => {
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
  world = await seedWorld();
});

describe("cross-tenant 404 sweep", () => {
  it("covers every dynamic route the application implements", () => {
    // Completeness, so a new `[id]` route cannot be added without joining the
    // matrix, and a route cannot be quietly dropped from it. The two sides are
    // derived independently: the right from `src/app/api`, the left from the
    // table above.
    const implemented = ROUTE_TREE.flatMap((route) =>
      route.path.includes(":")
        ? route.handlers.map((handler) => `${handler.method} ${route.path}`)
        : [],
    ).sort();

    const covered = CASES.map((c) => c.endpoint).sort();

    expect(covered).toEqual(implemented);
  });

  for (const c of CASES) {
    describe(c.endpoint, () => {
      it("refuses another organisation's id with 404", async () => {
        const foreignId = await seedOne(c.seedKind, world, world.globex);

        const response = await c.handler(
          requestFor(c, foreignId.toString(), world.token),
        );

        expect(response.status).toBe(404);
        expect(await bodyCode(response)).toBe("RECORD_NOT_FOUND");
      });

      it("answers a foreign id and an absent id identically", async () => {
        // Not a stylistic point: distinguishing them would make every route an
        // oracle for which ids exist in another tenant, which is the one thing
        // an id from another tenant must not be able to ask.
        const foreignId = await seedOne(c.seedKind, world, world.globex);

        const foreign = await c.handler(
          requestFor(c, foreignId.toString(), world.token),
        );
        const absent = await c.handler(
          requestFor(c, new Types.ObjectId().toString(), world.token),
        );

        expect(absent.status).toBe(foreign.status);
        expect(await bodyCode(absent)).toBe(await bodyCode(foreign));
      });

      if (c.readControl) {
        it("returns the caller's own record, so the 404 is not unconditional", async () => {
          const ownId = await seedOne(c.seedKind, world, world.acme);

          const response = await c.handler(
            requestFor(c, ownId.toString(), world.token),
          );

          expect(response.status).toBe(200);
        });
      }
    });
  }
});
