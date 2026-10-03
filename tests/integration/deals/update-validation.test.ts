import {
  connectToDatabase,
  disconnectDatabase,
  envelope,
  patchJson,
  resetAuthTables,
} from "@tests/support/auth-contract";
import mongoose, { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH } from "@/app/api/v1/deals/[id]/route";
import { DealModel } from "@/modules/deals/deal.model";
import { DealRepository } from "@/modules/deals/deal.repository";
import { UserModel } from "@/modules/identity";
import { issueSession } from "@/modules/identity/session.service";
import { OrganizationModel } from "@/modules/organizations";
import { MembershipModel } from "@/modules/organizations/membership.model";
import { RoleModel } from "@/modules/organizations/role.model";
import { PipelineModel } from "@/modules/pipelines";
import { setSessionCookie } from "@/shared/auth/session-http";

/**
 * Values a schema refuses, refused on the way *back in* rather than only on the
 * way in.
 *
 * Mongoose validates a document when it is created and does not validate an
 * update unless it is told to, so every constraint on every schema in this
 * application was enforced by `POST` and ignored by `PATCH`. `PATCH
 * /api/v1/deals/:id` took `value: -5` against `min: 0` and `probability: 999`
 * against `max: 100`, stored both, and handed the 999 to the forecast query that
 * weights a pipeline by probability. The row was valid when it arrived and
 * invalid when it left.
 *
 * A second failure sat behind the first. A value the schema cannot cast at all —
 * `"not-a-date"` into a date, a string that is not an id into an `ObjectId` — was
 * never recognised as a client mistake, so it became a 500 with the offending
 * value inside Mongoose's own message in the log. It is one typo, and it was
 * reported as a server fault.
 *
 * The fixtures are duplicated from `mass-assignment.test.ts` rather than shared
 * with it. That file is a security suite, and moving its helpers into a support
 * module would put the allowlist coverage one refactor away from not running.
 */
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
    organizationId: (org as never as { _id: Types.ObjectId })._id,
    key: "OWNER",
    name: "Owner",
    permissions: ["deals.read", "deals.update", "deals.create"],
    createdBy: (user as never as { _id: Types.ObjectId })._id,
    updatedBy: (user as never as { _id: Types.ObjectId })._id,
  });

  await MembershipModel.create({
    organizationId: (org as never as { _id: Types.ObjectId })._id,
    userId: (user as never as { _id: Types.ObjectId })._id,
    roleId: role._id,
    status: "ACTIVE",
    joinedAt: new Date(),
  });

  return { org, user };
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

/** A deal with one open stage, and the ids needed to address it. */
async function setupDeal() {
  const { org, user } = await createOrgAndUser();
  const organizationId = (org as never as { _id: Types.ObjectId })._id;
  const userId = (user as never as { _id: Types.ObjectId })._id;

  const pipeline = await PipelineModel.create({
    organizationId,
    name: "Sales",
    isDefault: true,
    order: 0,
    stages: [],
    createdBy: userId,
    updatedBy: userId,
  });

  const stageId = new Types.ObjectId();
  await PipelineModel.findByIdAndUpdate(pipeline._id, {
    stages: [
      {
        _id: stageId,
        key: "NEW",
        name: "New",
        order: 0,
        probability: 0,
        color: "blue",
        isWon: false,
        isLost: false,
      },
    ],
  });

  const deal = await DealModel.create({
    organizationId,
    name: "Big Deal",
    companyId: null,
    contactId: null,
    pipelineId: pipeline._id,
    stageId,
    ownerId: userId,
    value: 1000,
    currency: "USD",
    probability: 50,
    status: "OPEN",
    expectedCloseDate: new Date("2030-01-15T00:00:00.000Z"),
    closedAt: null,
    lostReason: null,
    description: null,
    sortOrder: 0,
    tags: [],
    customFields: {},
    createdBy: userId,
    updatedBy: userId,
  });

  return {
    dealId: deal._id,
    organizationId,
    userId,
    repo: new DealRepository(organizationId, userId),
  };
}

async function patchAs(
  dealId: Types.ObjectId,
  body: Record<string, unknown>,
  userId: Types.ObjectId,
  organizationId: Types.ObjectId,
) {
  const issued = await issueSession({
    userId,
    userAgent: "test",
    ip: "127.0.0.1",
  });
  const { SessionModel } = await import("@/modules/identity/session.model");
  await SessionModel.findOneAndUpdate(
    { _id: issued.session._id },
    { activeOrganizationId: organizationId },
  );

  const request = patchJson(`/api/v1/deals/${dealId}`, body);
  const headers = new Headers(request.headers);
  headers.set("cookie", setSessionCookie(issued.token));
  const init: RequestInit = { method: request.method, headers };
  if (request.body) {
    init.body = request.body;
    // @ts-expect-error - duplex required in Node
    init.duplex = "half";
  }

  return PATCH(new Request(request.url, init));
}

describe("PATCH /api/v1/deals/:id refuses what the schema refuses", () => {
  const cases: Array<{
    what: string;
    body: Record<string, unknown>;
    path: string;
    message: string;
    /**
     * The value as a string, which must appear nowhere in the details. Null for
     * a value that is not worth scanning for: every string contains the empty
     * one, so the assertion on it would be theatre.
     */
    value: string | null;
  }> = [
    {
      what: "a value below the declared minimum",
      body: { value: -5 },
      path: "value",
      message: "Must be 0 or greater.",
      value: "-5",
    },
    {
      what: "a probability above the declared maximum",
      body: { probability: 999 },
      path: "probability",
      message: "Must be 100 or less.",
      value: "999",
    },
    {
      what: "a name with nothing in it",
      body: { name: "" },
      path: "name",
      message: "This field is required.",
      value: null,
    },
    {
      what: "a name past the declared length",
      body: { name: "n".repeat(200) },
      path: "name",
      message: "Must be at most 160 characters.",
      value: "n".repeat(20),
    },
    {
      what: "a date that is not a date",
      body: { expectedCloseDate: "not-a-date" },
      path: "expectedCloseDate",
      message: "Not a valid date.",
      value: "not-a-date",
    },
    {
      what: "a company id that is not an id",
      body: { companyId: "not-an-object-id" },
      path: "companyId",
      message: "Not a valid ObjectId.",
      value: "not-an-object-id",
    },
    {
      what: "an owner id that is not an id",
      body: { ownerId: "not-an-object-id" },
      path: "ownerId",
      message: "Not a valid ObjectId.",
      value: "not-an-object-id",
    },
  ];

  it.each(cases)("refuses $what", async ({ body, path, message, value }) => {
    const { dealId, userId, organizationId } = await setupDeal();
    const before = await DealModel.findById(dealId).lean();

    const response = await patchAs(dealId, body, userId, organizationId);
    const parsed = await envelope(response);

    expect(response.status).toBe(422);
    expect(parsed.error?.code).toBe("VALIDATION_FAILED");
    // The field, so a client can highlight it, and the bound, so it knows what
    // to do about it.
    expect(parsed.error?.details).toContainEqual({ path, message });

    // Nothing was written. A refusal that half-applies is worse than no
    // refusal at all: the client is told the edit failed and the row has moved.
    expect(await DealModel.findById(dealId).lean()).toEqual(before);

    // And the value came back nowhere. Mongoose's own messages carry it —
    // `Path \`name\` (\`n…\`, length 200) is longer than…` — so the mapping has to
    // rebuild them, and this is where that is proved rather than intended.
    if (value !== null) {
      expect(JSON.stringify(parsed.error?.details ?? [])).not.toContain(value);
    }
  });

  it("does not put the offending value in the response body either", async () => {
    // The canary is long enough that no generated request id can contain it, so
    // this asserts on the whole body rather than only on `details` — which is
    // the assertion a reader actually wants, and the one that would catch a
    // value reflected into a message written somewhere else.
    const { dealId, userId, organizationId } = await setupDeal();

    const response = await patchAs(
      dealId,
      { expectedCloseDate: "LEAKCANARY" },
      userId,
      organizationId,
    );
    const text = await response.text();

    expect(response.status).toBe(422);
    expect(text).not.toContain("LEAKCANARY");
    expect(text).not.toContain("Cast");
  });
});

describe("PATCH /api/v1/deals/:id still accepts what the schema allows", () => {
  it("applies a valid edit and leaves every field it did not mention alone", async () => {
    // The other half, and the one that would catch a fix done by validating the
    // whole document on every update rather than the part that changed. A
    // `PATCH` that had to resend the entire deal to be accepted would be a
    // `PUT`.
    const { dealId, userId, organizationId } = await setupDeal();

    const response = await patchAs(
      dealId,
      { name: "Renamed", value: 5000 },
      userId,
      organizationId,
    );
    const parsed = await envelope<{ name: string; value: number }>(response);

    expect(response.status).toBe(200);
    expect(parsed.data?.name).toBe("Renamed");
    expect(parsed.data?.value).toBe(5000);

    const stored = await DealModel.findById(dealId).lean();
    expect(stored?.probability).toBe(50);
    expect(stored?.currency).toBe("USD");
    // Untouched in the request, untouched in the row. The date is here because
    // it is the field that would go missing if `$set` were rebuilt from the
    // payload rather than merged into the document.
    expect(stored?.expectedCloseDate?.toISOString()).toBe(
      "2030-01-15T00:00:00.000Z",
    );
    expect(stored?.updatedBy?.toString()).toBe(userId.toString());
  });

  it("accepts a fractional probability, which no schema bounds", async () => {
    // Recorded so that the line between "the schema's rule" and "a rule nobody
    // wrote" stays visible. `probability` is `Number` with no `min`, no `max` and
    // no integer check on any model in this tree, so 33.7 is a value this
    // application accepts, and inventing a constraint for it here would be a
    // schema change wearing a bug fix's clothes.
    const { dealId, userId, organizationId } = await setupDeal();

    const response = await patchAs(
      dealId,
      { probability: 33.7 },
      userId,
      organizationId,
    );

    expect(response.status).toBe(200);
    expect((await DealModel.findById(dealId).lean())?.probability).toBe(33.7);
  });
});

describe("one schema, both doors", () => {
  it("refuses on an update what a create already refused", async () => {
    // `create` has always validated. Stated as a pair so the invariant is the
    // test: the same document, the same schema, the same answer — rather than
    // two tests that happen to pass.
    const { dealId, repo } = await setupDeal();
    const stored = await DealModel.findById(dealId);
    if (!stored) throw new Error("the fixture deal was not created");
    const { _id, __v, ...template } = stored.toObject();

    const onCreate = await DealModel.create({ ...template, value: -5 }).then(
      () => null,
      (error: unknown) => error,
    );
    const onUpdate = await repo
      .findByIdAndUpdate(dealId, { $set: { value: -5 } })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(onCreate).toBeInstanceOf(mongoose.Error.ValidationError);
    expect(onUpdate).toBeInstanceOf(mongoose.Error.ValidationError);
    expect((await DealModel.findById(dealId).lean())?.value).toBe(1000);
  });

  it("will not let a caller turn update validation off", async () => {
    // The property that keeps the hole shut. Offering `runValidators` as an
    // option would leave every future caller one argument away from the bug
    // this file exists for, and the resulting write looks identical to a
    // validated one — so nothing in review would catch it.
    const { dealId, repo } = await setupDeal();

    const refused = await repo
      .updateOne(
        { _id: dealId },
        { $set: { probability: 999 } },
        { runValidators: false },
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    const many = await repo
      .updateMany(
        { _id: dealId },
        { $set: { probability: 999 } },
        { runValidators: false },
      )
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(refused).toBeInstanceOf(mongoose.Error.ValidationError);
    expect(many).toBeInstanceOf(mongoose.Error.ValidationError);
    expect((await DealModel.findById(dealId).lean())?.probability).toBe(50);
  });
});
