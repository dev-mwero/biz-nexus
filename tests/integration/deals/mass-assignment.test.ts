import {
  connectToDatabase,
  disconnectDatabase,
  envelope,
  patchJson,
  resetAuthTables,
} from "@tests/support/auth-contract";
import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH } from "@/app/api/v1/deals/[id]/route";
import { DealModel, type DealStatus } from "@/modules/deals/deal.model";
import { DealRepository } from "@/modules/deals/deal.repository";
import {
  DealError,
  DealService,
  type UpdateDealInput,
} from "@/modules/deals/deal.service";
import { UserModel } from "@/modules/identity";
import { issueSession } from "@/modules/identity/session.service";
import { OrganizationModel } from "@/modules/organizations";
import { MembershipModel } from "@/modules/organizations/membership.model";
import { RoleModel } from "@/modules/organizations/role.model";
import { PipelineModel } from "@/modules/pipelines";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { setSessionCookie } from "@/shared/auth/session-http";

async function createOrgAndUser() {
  const org = await OrganizationModel.create({
    name: "Test Org",
    slug: `test-org-${Date.now()}-${Math.random()}`,
  });

  const user = await UserModel.create({
    email: `owner-${Date.now()}@example.com`,
    name: "Owner",
    passwordHash: "hash",
    emailVerifiedAt: new Date(),
    lastLoginAt: new Date(),
  });

  const role = await RoleModel.create({
    organizationId: (org as any)._id,
    key: "OWNER",
    name: "Owner",
    permissions: ["deals.read", "deals.update", "deals.create"],
    createdBy: (user as any)._id,
    updatedBy: (user as any)._id,
  });

  await MembershipModel.create({
    organizationId: (org as any)._id,
    userId: (user as any)._id,
    roleId: role._id,
    status: "ACTIVE",
    joinedAt: new Date(),
  });

  return { org, user, role };
}

function asObjectId(id: string | Types.ObjectId): Types.ObjectId {
  return typeof id === "string" ? new Types.ObjectId(id) : id;
}

/**
 * Pass a field `UpdateDealInput` forbids.
 *
 * The cast is the test, not a way around it. These fields are unreachable
 * through the type on purpose, and the runtime allowlist exists for the callers
 * who are not going through the type at all, so writing the forbidden shape here
 * is the only way to reach the code that has to hold.
 */
function forbidden(fields: Record<string, unknown>): UpdateDealInput {
  return fields as UpdateDealInput;
}

/**
 * The error a call refused with, so the code and message can be asserted on.
 *
 * Throws when the call resolves, because a test that reads `error.code` off a
 * value that is not an error is a test that passes for the wrong reason.
 */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the call to be refused, and it was not");
    },
    (error: unknown) => error,
  );
}

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetAuthTables();
  await DealModel.deleteMany({});
  await PipelineModel.deleteMany({});
});

async function setupDeal() {
  const { org, user } = await createOrgAndUser();

  const pipeline = await PipelineModel.create({
    organizationId: (org as any)._id,
    name: "Sales",
    isDefault: true,
    order: 0,
    stages: [],
    createdBy: (user as any)._id,
    updatedBy: (user as any)._id,
  });

  const stage1Id = new Types.ObjectId();
  const stage2Id = new Types.ObjectId();
  const stage3Id = new Types.ObjectId();
  await PipelineModel.findByIdAndUpdate((pipeline as any)._id, {
    stages: [
      {
        _id: stage1Id,
        key: "NEW",
        name: "New",
        order: 0,
        probability: 0,
        color: "blue",
        isWon: false,
        isLost: false,
      },
      {
        _id: stage2Id,
        key: "WON",
        name: "Won",
        order: 1,
        probability: 100,
        color: "green",
        isWon: true,
        isLost: false,
      },
      {
        _id: stage3Id,
        key: "LOST",
        name: "Lost",
        order: 2,
        probability: 0,
        color: "red",
        isWon: false,
        isLost: true,
      },
    ],
  });

  const deal = await DealModel.create({
    organizationId: (org as any)._id,
    name: "Big Deal",
    companyId: null,
    contactId: null,
    pipelineId: (pipeline as any)._id,
    stageId: stage1Id,
    ownerId: (user as any)._id,
    value: 1000,
    currency: "USD",
    probability: 50,
    status: "OPEN",
    expectedCloseDate: null,
    closedAt: null,
    lostReason: null,
    description: null,
    sortOrder: 0,
    tags: [],
    customFields: {},
    createdBy: (user as any)._id,
    updatedBy: (user as any)._id,
  });

  const repo = new DealRepository((org as any)._id, (user as any)._id);
  const pipelineRepo = new PipelineRepository(
    (org as any)._id,
    (user as any)._id,
  );
  const service = new DealService(repo, pipelineRepo, (user as any)._id);

  return {
    org,
    user,
    pipeline,
    stage1: { _id: stage1Id },
    stage2: { _id: stage2Id },
    stage3: { _id: stage3Id },
    deal,
    // The ids on their own, so a caller that only needs to name the row does not
    // have to reach through the document for them.
    organizationId: asObjectId((org as any)._id),
    userId: asObjectId((user as any)._id),
    dealId: asObjectId((deal as any)._id),
    repo,
    pipelineRepo,
    service,
  };
}

async function makeRequestWithSession(
  request: Request,
  userId: string | Types.ObjectId,
  orgId?: string | Types.ObjectId,
) {
  const issued = await issueSession({
    userId: typeof userId === "string" ? new Types.ObjectId(userId) : userId,
    userAgent: "test",
    ip: "127.0.0.1",
  });
  const cookie = setSessionCookie(issued.token);
  // Clone by creating new request with same body but added cookie
  const headers = new Headers(request.headers);
  headers.set("cookie", cookie);
  const init: RequestInit = {
    method: request.method,
    headers,
  };
  if (request.body) {
    init.body = request.body;
    // @ts-expect-error - duplex required in Node
    init.duplex = "half";
  }
  // Also set active org for the session by updating the session model
  if (orgId) {
    const { SessionModel } = await import("@/modules/identity/session.model");
    await SessionModel.findOneAndUpdate(
      { _id: issued.session._id },
      {
        activeOrganizationId:
          typeof orgId === "string" ? new Types.ObjectId(orgId) : orgId,
      },
    );
  }
  return new Request(request.url, init);
}
describe("Deal PATCH security", () => {
  it("rejects organizationId in patch", async () => {
    const { org, user, deal } = await setupDeal();

    const { org: otherOrg } = await createOrgAndUser();

    // Attempt to relocate deal to other org via PATCH
    const response = await PATCH(
      await makeRequestWithSession(
        patchJson(`/api/v1/deals/${(deal as any)._id}`, {
          organizationId: (otherOrg as any)._id.toString(),
        }),
        (user as any)._id,
        (org as any)._id,
      ),
    );

    const body = await envelope(response);
    expect(response.status).toBe(422);
    expect(body.error?.code).toBe("VALIDATION_FAILED");

    // Verify deal is still in original org
    const reRead = await DealModel.findById((deal as any)._id);
    expect(reRead).not.toBeNull();
    expect(reRead?.organizationId.toString()).toBe((org as any)._id.toString());
  });

  it("rejects status in patch", async () => {
    const { org, user, deal } = await setupDeal();

    const response = await PATCH(
      await makeRequestWithSession(
        patchJson(`/api/v1/deals/${(deal as any)._id}`, {
          status: "WON" as unknown as DealStatus,
        }),
        (user as any)._id,
        (org as any)._id,
      ),
    );

    const body = await envelope(response);
    expect(response.status).toBe(422);
    expect(body.error?.code).toBe("VALIDATION_FAILED");

    const reRead = await DealModel.findById((deal as any)._id);
    expect(reRead?.status).toBe("OPEN");
  });

  it("rejects closedAt in patch", async () => {
    const { org, user, deal } = await setupDeal();

    const response = await PATCH(
      await makeRequestWithSession(
        patchJson(`/api/v1/deals/${(deal as any)._id}`, {
          closedAt: new Date().toISOString(),
        }),
        (user as any)._id,
        (org as any)._id,
      ),
    );

    const body = await envelope(response);
    expect(response.status).toBe(422);
  });

  it("rejects lostReason in patch", async () => {
    const { org, user, deal } = await setupDeal();

    const response = await PATCH(
      await makeRequestWithSession(
        patchJson(`/api/v1/deals/${(deal as any)._id}`, {
          lostReason: "Too expensive",
        }),
        (user as any)._id,
        (org as any)._id,
      ),
    );

    const body = await envelope(response);
    expect(response.status).toBe(422);
  });

  it("rejects deletedAt in patch", async () => {
    const { org, user, deal } = await setupDeal();

    const response = await PATCH(
      await makeRequestWithSession(
        patchJson(`/api/v1/deals/${(deal as any)._id}`, {
          deletedAt: new Date().toISOString(),
        }),
        (user as any)._id,
        (org as any)._id,
      ),
    );

    const body = await envelope(response);
    expect(response.status).toBe(422);
  });

  it("rejects sortOrder in patch", async () => {
    const { org, user, deal } = await setupDeal();

    const response = await PATCH(
      await makeRequestWithSession(
        patchJson(`/api/v1/deals/${(deal as any)._id}`, {
          sortOrder: 99,
        }),
        (user as any)._id,
        (org as any)._id,
      ),
    );

    const body = await envelope(response);
    expect(response.status).toBe(422);
  });

  it("rejects createdBy in patch", async () => {
    const { org, user, deal } = await setupDeal();
    const res = await createOrgAndUser();
    const otherUser = res.user as any;

    const response = await PATCH(
      await makeRequestWithSession(
        patchJson(`/api/v1/deals/${(deal as any)._id}`, {
          createdBy: (otherUser as any)._id.toString(),
        }),
        (user as any)._id,
        (org as any)._id,
      ),
    );

    const body = await envelope(response);
    expect(response.status).toBe(422);
  });

  it("rejects stageId and points to move endpoint", async () => {
    const { org, user, deal, stage2 } = await setupDeal();

    const response = await PATCH(
      await makeRequestWithSession(
        patchJson(`/api/v1/deals/${(deal as any)._id}`, {
          stageId: (stage2 as any)._id.toString(),
        }),
        (user as any)._id,
        (org as any)._id,
      ),
    );

    const body = await envelope(response);
    expect(response.status).toBe(422);
    expect(body.error?.code).toBe("VALIDATION_FAILED");
    expect(body.error?.message).toMatch(/move/i);
    expect(body.error?.message).toMatch(/deals\/:id\/move/i);
  });

  it("rejects pipelineId with move endpoint message", async () => {
    const { org, user, deal, pipeline } = await setupDeal();

    const response = await PATCH(
      await makeRequestWithSession(
        patchJson(`/api/v1/deals/${(deal as any)._id}`, {
          pipelineId: (pipeline as any)._id.toString(),
        }),
        (user as any)._id,
        (org as any)._id,
      ),
    );

    const body = await envelope(response);
    expect(response.status).toBe(422);
    expect(body.error?.message).toMatch(/move/i);
  });
});

/**
 * The same allowlist, one layer down.
 *
 * The HTTP tests above prove the zod schema refuses these fields. They cannot
 * prove `DealService.update` does, and the service is the layer that has to hold
 * when a route forgets to validate - which is the bug this whole change started
 * from. So every case here calls the service directly with no request, no route
 * handler and no session.
 */
describe("DealService.update allowlist, called directly", () => {
  it("refuses organizationId and the deal stays in its own tenant", async () => {
    const { organizationId, dealId, service } = await setupDeal();
    const { org: otherOrg } = await createOrgAndUser();
    const otherOrgId = asObjectId((otherOrg as any)._id);

    // Settled rather than refused, so the row can be read either way. Asserting
    // the document first means a failure names the damage - this deal now belongs
    // to the other organisation - instead of reporting only that some exception
    // did not arrive. Both assertions matter and both run; the order is only
    // about which one gets to describe the failure.
    const attempt: Promise<unknown> = service
      .update(dealId, forbidden({ organizationId: otherOrgId }))
      .catch((error: unknown) => error);
    await attempt;

    const reRead = await DealModel.findById(dealId);
    expect(reRead).not.toBeNull();
    expect(reRead?.organizationId.toString()).toBe(organizationId.toString());
    expect(await DealModel.countDocuments({ organizationId: otherOrgId })).toBe(
      0,
    );

    const error = await attempt;
    expect(error).toBeInstanceOf(DealError);
    expect((error as DealError).code).toBe("VALIDATION_FAILED");
    expect((error as DealError).message).toContain("organizationId");
  });

  it.each<[string, unknown]>([
    ["status", "WON"],
    ["closedAt", "2020-01-01T00:00:00.000Z"],
    ["lostReason", "Too expensive"],
    ["deletedAt", "2020-01-01T00:00:00.000Z"],
    ["sortOrder", 99],
  ])("refuses %s", async (field, value) => {
    const { dealId, service } = await setupDeal();

    const error = await rejection(
      service.update(dealId, forbidden({ [field]: value })),
    );

    expect(error).toBeInstanceOf(DealError);
    expect((error as DealError).code).toBe("VALIDATION_FAILED");
    expect((error as DealError).message).toContain(field);
  });

  it("refuses stageId and names the move endpoint", async () => {
    const { dealId, stage2, service } = await setupDeal();

    const error = await rejection(
      service.update(dealId, forbidden({ stageId: stage2._id.toString() })),
    );

    expect(error).toBeInstanceOf(DealError);
    expect((error as DealError).code).toBe("VALIDATION_FAILED");
    expect((error as DealError).message).toContain(
      "POST /api/v1/deals/:id/move",
    );
  });

  it("applies a legitimate edit and leaves organizationId and updatedBy alone", async () => {
    const { organizationId, userId, dealId, service } = await setupDeal();

    const result = await service.update(dealId, {
      name: "Renamed Deal",
      value: 5000,
      currency: "EUR",
      probability: 75,
    });

    expect(result?.name).toBe("Renamed Deal");
    expect(result?.value).toBe(5000);
    expect(result?.currency).toBe("EUR");
    expect(result?.probability).toBe(75);

    const reRead = await DealModel.findById(dealId);
    expect(reRead?.organizationId.toString()).toBe(organizationId.toString());
    // `updatedBy` is the repository's actor stamp, written on every update and
    // never taken from the payload. Asserting it here is what says the caller
    // cannot choose it.
    expect(reRead?.updatedBy?.toString()).toBe(userId.toString());
  });
});

describe("moveDeal maintains invariant state", () => {
  it("moves to won stage sets WON and closedAt", async () => {
    const { org, user, deal, stage2, service } = await setupDeal();

    const result = await service.moveDeal((deal as any)._id, {
      stageId: (stage2 as any)._id.toString(),
      sortOrder: 0,
    });

    expect(result.deal).toBeDefined();
    expect(result.deal.status).toBe("WON");
    expect(result.deal.closedAt).not.toBeNull();
  });

  it("moves to lost stage sets LOST and closedAt and lostReason", async () => {
    const { org, user, deal, stage3, service } = await setupDeal();

    const result = await service.moveDeal((deal as any)._id, {
      stageId: (stage3 as any)._id.toString(),
      sortOrder: 0,
      reason: "Budget cut",
    });

    expect(result.deal.status).toBe("LOST");
    expect(result.deal.closedAt).not.toBeNull();
    expect(result.deal.lostReason).toBe("Budget cut");
  });

  it("moves back to open stage clears closedAt and lostReason", async () => {
    const { org, user, deal, stage1, stage3, service } = await setupDeal();

    // First move to lost
    await service.moveDeal((deal as any)._id, {
      stageId: (stage3 as any)._id.toString(),
      sortOrder: 0,
      reason: "No fit",
    });

    // Move back to open
    const result = await service.moveDeal((deal as any)._id, {
      stageId: (stage1 as any)._id.toString(),
      sortOrder: 0,
    });

    expect(result.deal.status).toBe("OPEN");
    expect(result.deal.closedAt).toBeNull();
    expect(result.deal.lostReason).toBeNull();
  });
});
