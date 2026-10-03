import { passwordHash } from "@tests/support/auth-contract";
import { Types } from "mongoose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as createActivity } from "@/app/api/v1/activities/route";
import { connectToDatabase } from "@/db/connection";
import { ActivityModel } from "@/modules/activities";
import { ContactModel, ContactService } from "@/modules/crm";
import { SessionModel, UserModel } from "@/modules/identity";
import { issueSession } from "@/modules/identity/session.service";
import {
  createOrganization,
  MembershipModel,
  OrganizationModel,
  RoleModel,
} from "@/modules/organizations";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * `POST /activities` must not accept a subject id the caller's organisation
 * does not own.
 *
 * The id used to be written into `subjects` without a lookup, so a member could
 * attach an activity to another tenant's record and have it surface on that
 * record's timeline.
 */

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    ActivityModel.deleteMany({}),
    ContactModel.deleteMany({}),
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    RoleModel.deleteMany({}),
    OrganizationModel.deleteMany({}),
  ]);
});

async function setupOrg(name: string) {
  const user = await UserModel.create({
    email: `activity-${new Types.ObjectId()}@example.com`,
    name,
    passwordHash: await passwordHash(),
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

function postActivity(body: unknown, token: string): Promise<Response> {
  const request = new Request("http://localhost:3000/api/v1/activities", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${token}`,
    },
    body: JSON.stringify(body),
  });
  return createActivity(request);
}

describe("POST /api/v1/activities", () => {
  let org: Awaited<ReturnType<typeof setupOrg>>;
  let otherOrg: Awaited<ReturnType<typeof setupOrg>>;
  let contactId: Types.ObjectId;

  beforeEach(async () => {
    org = await setupOrg("Activities Org");
    otherOrg = await setupOrg("Other Org");

    const contactService = new ContactService(
      org.organization._id,
      org.user._id,
    );
    const contact = await contactService.create({
      organizationId: org.organization._id,
      actorId: org.user._id,
      firstName: "Ada",
      lastName: "Lovelace",
      ownerId: org.user._id,
      status: "LEAD",
    });
    contactId = contact._id;
  });

  it("records an activity on a record the caller owns", async () => {
    const res = await postActivity(
      {
        entityType: "contact",
        entityId: contactId.toString(),
        type: "NOTE",
        title: "Called",
      },
      org.token,
    );
    expect(res.status).toBe(201);
  });

  it("rejects an entity id that does not exist in this organisation", async () => {
    const res = await postActivity(
      {
        entityType: "contact",
        entityId: new Types.ObjectId().toString(),
        type: "NOTE",
        title: "Called",
      },
      org.token,
    );
    expect(res.status).toBe(422);
  });

  it("rejects an entity id owned by another organisation", async () => {
    const res = await postActivity(
      {
        entityType: "contact",
        entityId: contactId.toString(),
        type: "NOTE",
        title: "Called",
      },
      otherOrg.token,
    );
    expect(res.status).toBe(422);
  });

  it("rejects an unknown entity type", async () => {
    const res = await postActivity(
      {
        entityType: "invoice",
        entityId: new Types.ObjectId().toString(),
        type: "NOTE",
        title: "Called",
      },
      org.token,
    );
    expect(res.status).toBe(422);
  });
});
