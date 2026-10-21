import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as dealTimeline } from "@/app/api/v1/deals/[id]/timeline/route";
import { connectToDatabase } from "@/db/connection";
import { ActivityModel } from "@/modules/activities";
import { recordActivity } from "@/modules/activities/activity.service";
import { DealModel } from "@/modules/deals/deal.model";
import { SessionModel, UserModel } from "@/modules/identity";
import { hashPassword } from "@/modules/identity/password";
import { issueSession } from "@/modules/identity/session.service";
import {
  createOrganization,
  MembershipModel,
  OrganizationModel,
  RoleModel,
} from "@/modules/organizations";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * `GET /api/v1/deals/:id/timeline` must answer the same 404 for a deal that
 * belongs to another organisation as its sibling `GET /api/v1/deals/:id` does.
 *
 * It did not. `timelineForEntity` filters on `{ organizationId, "subjects.entityId" }`
 * and returns an empty array for anything, so a foreign id came back as
 * `200 { data: [] }` while the same id under `/deals/:id` came back `404`. That
 * asymmetry is the whole problem: an id that exists in another tenant is then
 * distinguishable from one that exists nowhere — the endpoint answers "yes,
 * empty" to the first and "yes, empty" to the second, but the sibling route
 * already told you which is which, and a client can use the pair as an oracle.
 *
 * The fix resolves the deal through the tenant-scoped repository before the
 * timeline is read. These tests hold that: a foreign id and an absent id must be
 * indistinguishable, and an own id must still work.
 */

const ORIGIN = "http://localhost:3000";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    ActivityModel.deleteMany({}),
    DealModel.deleteMany({}),
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    RoleModel.deleteMany({}),
    OrganizationModel.deleteMany({}),
  ]);
});

async function setupOrg(name: string) {
  const user = await UserModel.create({
    email: `timeline-${new Types.ObjectId()}@example.com`,
    name,
    passwordHash: await hashPassword("correct horse battery staple"),
  });
  const { organization } = await createOrganization({
    name,
    ownerId: user._id,
  });
  const { token, session } = await issueSession({ userId: user._id });
  await SessionModel.updateOne(
    { _id: session._id },
    { $set: { activeOrganizationId: organization._id } },
  );
  return { user, organization, token };
}

async function seedDeal(
  organizationId: Types.ObjectId,
  ownerId: Types.ObjectId,
) {
  return DealModel.create({
    organizationId,
    name: "Timeline deal",
    pipelineId: new Types.ObjectId(),
    stageId: new Types.ObjectId(),
    ownerId,
    createdBy: ownerId,
  });
}

function getTimeline(dealId: string, token: string): Promise<Response> {
  const request = new Request(`${ORIGIN}/api/v1/deals/${dealId}/timeline`, {
    method: "GET",
    headers: {
      origin: ORIGIN,
      cookie: `${SESSION_COOKIE}=${token}`,
    },
  });
  return dealTimeline(request);
}

describe("GET /api/v1/deals/:id/timeline", () => {
  it("returns the deal's own timeline to a member of its organisation", async () => {
    const org = await setupOrg("Timeline Org");
    const deal = await seedDeal(org.organization._id, org.user._id);
    await recordActivity({
      organizationId: org.organization._id,
      type: "NOTE",
      title: "Called the client",
      ownerId: org.user._id,
      subjects: [{ entityType: "deal", entityId: deal._id }],
    });

    const res = await getTimeline(deal._id.toString(), org.token);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ title: string }> };
    expect(body.data.map((activity) => activity.title)).toContain(
      "Called the client",
    );
  });

  it("answers 404 for another organisation's deal, not an empty timeline", async () => {
    const acme = await setupOrg("Acme");
    const globex = await setupOrg("Globex");
    const acmeDeal = await seedDeal(acme.organization._id, acme.user._id);
    // An activity in Acme, so a leak would show its title to Globex.
    await recordActivity({
      organizationId: acme.organization._id,
      type: "NOTE",
      title: "Acme only",
      ownerId: acme.user._id,
      subjects: [{ entityType: "deal", entityId: acmeDeal._id }],
    });

    const res = await getTimeline(acmeDeal._id.toString(), globex.token);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { data?: unknown };
    expect(body.data).toBeUndefined();
  });

  it("answers identically for a foreign id and an id that exists nowhere", async () => {
    const acme = await setupOrg("Acme");
    const globex = await setupOrg("Globex");
    const acmeDeal = await seedDeal(acme.organization._id, acme.user._id);
    const absent = new Types.ObjectId();

    const foreign = await getTimeline(acmeDeal._id.toString(), globex.token);
    const missing = await getTimeline(absent.toString(), globex.token);

    // Same status and same error: the pair must not tell an attacker which ids
    // are real somewhere else in the system. `requestId` is per-request and is
    // compared out; every field a caller can act on must match.
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);

    const strip = (body: { error: { requestId?: string } }) => {
      const { requestId, ...error } = body.error;
      void requestId;
      return error;
    };
    const foreignBody = (await foreign.json()) as {
      error: { requestId?: string };
    };
    const missingBody = (await missing.json()) as {
      error: { requestId?: string };
    };
    expect(strip(foreignBody)).toEqual(strip(missingBody));
  });

  it("refuses a malformed id with 422 rather than a driver error", async () => {
    const org = await setupOrg("Timeline Org");

    const res = await getTimeline("not-an-object-id", org.token);

    expect(res.status).toBe(422);
  });
});
