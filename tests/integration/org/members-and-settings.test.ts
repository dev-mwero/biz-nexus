import {
  connectToDatabase,
  createUser,
  disconnectDatabase,
  envelope,
  ORIGIN,
  refusal,
} from "@tests/support/auth-contract";
import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as leaveRoute } from "@/app/api/v1/organizations/current/leave/route";
import {
  DELETE as deleteMemberRoute,
  PATCH as updateMemberRoute,
} from "@/app/api/v1/organizations/current/members/[id]/route";
import { GET as listMembersRoute } from "@/app/api/v1/organizations/current/members/route";
import {
  GET as getOrganizationRoute,
  PATCH as updateOrganizationRoute,
} from "@/app/api/v1/organizations/current/route";
import { AuditLogModel } from "@/modules/audit";
import { issueSession, UserModel } from "@/modules/identity";
import type { MemberView } from "@/modules/organizations";
import {
  createOrganization,
  MembershipModel,
  type Organization,
  OrganizationModel,
  RoleModel,
  setActiveOrganization,
} from "@/modules/organizations";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * The organisation and member endpoints, driven as handlers.
 *
 * The service suite covers the rules; this one covers what a caller can reach
 * and what they are told: which permission each verb demands, that a viewer's
 * refusal is a 403 and not a 404, that a member id from another tenant is
 * indistinguishable from an absent one, that the tenant comes from the session
 * and never from the URL, and that a settings change leaves an audit row behind.
 *
 * Real handlers, real `Request`s, real cookies, real database — the same reason
 * `invitation-api.test.ts` drives handlers rather than services.
 */

const CURRENT = "/api/v1/organizations/current";
const MEMBERS = `${CURRENT}/members`;
const LEAVE = `${CURRENT}/leave`;

interface Actor {
  cookie: string;
  sessionId: Types.ObjectId;
  userId: Types.ObjectId;
}

interface Org {
  owner: Actor;
  organization: Organization;
  roleIds: Record<string, Types.ObjectId>;
}

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    RoleModel.deleteMany({}),
    OrganizationModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
  ]);
});

async function actor(email?: string): Promise<Actor> {
  const user = await createUser({
    // Every actor needs its own address: `createUser` defaults to a fixed one,
    // and the `users.email` unique index refuses the second caller otherwise.
    email: email ?? `actor-${new Types.ObjectId().toString()}@example.com`,
    name: "Someone",
  });
  const { token, session } = await issueSession({ userId: user._id });
  return {
    cookie: `${SESSION_COOKIE}=${token}`,
    sessionId: session._id as Types.ObjectId,
    userId: user._id as unknown as Types.ObjectId,
  };
}

async function withOrg(name = "Acme"): Promise<Org> {
  const owner = await actor(`${name.toLowerCase()}-${Date.now()}@example.com`);
  const { organization } = await createOrganization({
    name,
    ownerId: owner.userId,
  });
  await setActiveOrganization(owner.sessionId, organization._id.toString());

  const roleIds: Record<string, Types.ObjectId> = {};
  for (const role of await RoleModel.find({
    organizationId: organization._id,
  })) {
    roleIds[role.key] = role._id;
  }

  return { owner, organization, roleIds };
}

async function addMember(
  org: Org,
  member: Actor,
  roleKey = "MEMBER",
): Promise<Types.ObjectId> {
  const membership = await MembershipModel.create({
    organizationId: org.organization._id,
    userId: member.userId,
    roleId: org.roleIds[roleKey],
    status: "ACTIVE",
    joinedAt: new Date(),
  });
  await setActiveOrganization(
    member.sessionId,
    org.organization._id.toString(),
  );
  return membership._id as Types.ObjectId;
}

async function ownMembershipId(org: Org, userId: Types.ObjectId) {
  const membership = await MembershipModel.findOne({
    organizationId: org.organization._id,
    userId,
  });
  return membership?._id as Types.ObjectId;
}

function get(path: string, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "GET",
    ...(cookie ? { headers: { cookie } } : {}),
  });
}

function send(
  method: "PATCH" | "POST" | "DELETE",
  path: string,
  cookie: string,
  body?: unknown,
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("GET /organizations/current", () => {
  it("returns the caller's active organisation", async () => {
    const org = await withOrg();

    const response = await getOrganizationRoute(get(CURRENT, org.owner.cookie));
    const body = await envelope<{ id: string; name: string; slug: string }>(
      response,
    );

    expect(response.status).toBe(200);
    expect(body.data?.id).toBe(org.organization._id.toString());
    expect(body.data?.name).toBe("Acme");

    // Storage and audit details do not go on the wire.
    const raw = JSON.stringify(body.data);
    expect(raw).not.toContain("deletedAt");
    expect(raw).not.toContain("updatedBy");
    expect(raw).not.toContain("__v");
  });

  it("answers a viewer, who holds organization.read", async () => {
    const org = await withOrg();
    const viewer = await actor();
    await addMember(org, viewer, "VIEWER");

    const response = await getOrganizationRoute(get(CURRENT, viewer.cookie));
    expect(response.status).toBe(200);
  });

  it("refuses a caller with no session", async () => {
    const response = await getOrganizationRoute(get(CURRENT));
    expect(response.status).toBe(401);
  });
});

describe("PATCH /organizations/current", () => {
  it("changes settings and writes an audit row", async () => {
    const org = await withOrg();

    const response = await updateOrganizationRoute(
      send("PATCH", CURRENT, org.owner.cookie, {
        name: "Acme Renamed",
        timezone: "Europe/London",
        weekStartsOn: 0,
      }),
    );
    const body = await envelope<{ name: string; timezone: string }>(response);

    expect(response.status).toBe(200);
    expect(body.data?.name).toBe("Acme Renamed");
    expect(body.data?.timezone).toBe("Europe/London");

    const audit = await AuditLogModel.findOne({
      organizationId: org.organization._id,
      action: "settings.update",
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe("organization");
    expect(audit?.changes.after).toMatchObject({
      name: "Acme Renamed",
      timezone: "Europe/London",
    });
    expect(audit?.changes.before).toMatchObject({ name: "Acme" });
  });

  it("refuses an unknown key rather than dropping it", async () => {
    const org = await withOrg();

    const response = await updateOrganizationRoute(
      send("PATCH", CURRENT, org.owner.cookie, { slug: "hijacked" }),
    );

    expect(response.status).toBe(422);
    // And the field it named was not written.
    const reloaded = await OrganizationModel.findById(org.organization._id);
    expect(reloaded?.slug).not.toBe("hijacked");
  });

  it("refuses a patch that changes nothing", async () => {
    const org = await withOrg();

    const response = await updateOrganizationRoute(
      send("PATCH", CURRENT, org.owner.cookie, {}),
    );

    expect(response.status).toBe(422);
  });

  it("refuses a viewer with 403, not 404", async () => {
    const org = await withOrg();
    const viewer = await actor();
    await addMember(org, viewer, "VIEWER");

    const response = await updateOrganizationRoute(
      send("PATCH", CURRENT, viewer.cookie, { name: "Nope" }),
    );

    expect(response.status).toBe(403);
  });

  it("lets an admin change settings", async () => {
    const org = await withOrg();
    const admin = await actor();
    await addMember(org, admin, "ADMIN");

    const response = await updateOrganizationRoute(
      send("PATCH", CURRENT, admin.cookie, { currency: "gbp" }),
    );
    const body = await envelope<{ currency: string }>(response);

    expect(response.status).toBe(200);
    expect(body.data?.currency).toBe("GBP");
  });
});

describe("GET /organizations/current/members", () => {
  it("resolves each membership to its user and role", async () => {
    const org = await withOrg();
    const member = await actor("dana@example.com");
    await addMember(org, member, "MEMBER");

    const response = await listMembersRoute(get(MEMBERS, org.owner.cookie));
    const body = await envelope<MemberView[]>(response);

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(2);

    const dana = body.data?.find((row) => row.email === "dana@example.com");
    expect(dana?.roleKey).toBe("MEMBER");
    expect(dana?.name).toBe("Someone");
    expect(dana?.status).toBe("ACTIVE");
  });

  it("excludes suspended members unless asked", async () => {
    const org = await withOrg();
    const member = await actor();
    const membershipId = await addMember(org, member, "MEMBER");

    await MembershipModel.updateOne(
      { _id: membershipId },
      { $set: { status: "SUSPENDED" } },
    );

    const withoutSuspended = await listMembersRoute(
      get(MEMBERS, org.owner.cookie),
    );
    expect((await envelope<MemberView[]>(withoutSuspended)).data).toHaveLength(
      1,
    );

    const withSuspended = await listMembersRoute(
      get(`${MEMBERS}?includeSuspended=true`, org.owner.cookie),
    );
    expect((await envelope<MemberView[]>(withSuspended)).data).toHaveLength(2);
  });

  it("refuses a caller with no session", async () => {
    const response = await listMembersRoute(get(MEMBERS));
    expect(response.status).toBe(401);
  });
});

describe("PATCH /organizations/current/members/:id", () => {
  it("changes a member's role by key", async () => {
    const org = await withOrg();
    const admin = await actor();
    await addMember(org, admin, "ADMIN");
    const member = await actor();
    const membershipId = await addMember(org, member, "MEMBER");

    const response = await updateMemberRoute(
      send("PATCH", `${MEMBERS}/${membershipId}`, admin.cookie, {
        roleKey: "VIEWER",
      }),
    );
    const body = await envelope<MemberView>(response);

    expect(response.status).toBe(200);
    expect(body.data?.roleKey).toBe("VIEWER");
  });

  it("refuses to assign OWNER", async () => {
    const org = await withOrg();
    const admin = await actor();
    await addMember(org, admin, "ADMIN");
    const member = await actor();
    const membershipId = await addMember(org, member, "MEMBER");

    const response = await updateMemberRoute(
      send("PATCH", `${MEMBERS}/${membershipId}`, admin.cookie, {
        roleKey: "OWNER",
      }),
    );

    expect(response.status).toBe(422);
  });

  it("suspends and restores a member", async () => {
    const org = await withOrg();
    const member = await actor();
    const membershipId = await addMember(org, member, "MEMBER");

    const suspended = await updateMemberRoute(
      send("PATCH", `${MEMBERS}/${membershipId}`, org.owner.cookie, {
        status: "SUSPENDED",
      }),
    );
    expect(suspended.status).toBe(200);
    expect((await envelope<MemberView>(suspended)).data?.status).toBe(
      "SUSPENDED",
    );

    const restored = await updateMemberRoute(
      send("PATCH", `${MEMBERS}/${membershipId}`, org.owner.cookie, {
        status: "ACTIVE",
      }),
    );
    expect(restored.status).toBe(200);
    expect((await envelope<MemberView>(restored)).data?.status).toBe("ACTIVE");
  });

  it("refuses a viewer with 403", async () => {
    const org = await withOrg();
    const viewer = await actor();
    await addMember(org, viewer, "VIEWER");
    const member = await actor();
    const membershipId = await addMember(org, member, "MEMBER");

    const response = await updateMemberRoute(
      send("PATCH", `${MEMBERS}/${membershipId}`, viewer.cookie, {
        status: "SUSPENDED",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("answers a foreign membership id as 404", async () => {
    const acme = await withOrg("Acme");
    const globex = await withOrg("Globex");
    const foreign = await actor();
    const foreignMembershipId = await addMember(globex, foreign, "MEMBER");

    const response = await updateMemberRoute(
      send("PATCH", `${MEMBERS}/${foreignMembershipId}`, acme.owner.cookie, {
        status: "SUSPENDED",
      }),
    );

    expect(response.status).toBe(404);
    expect((await refusal(response)).body).toContain("RECORD_NOT_FOUND");
  });

  it("answers a malformed id as 400", async () => {
    const org = await withOrg();

    const response = await updateMemberRoute(
      send("PATCH", `${MEMBERS}/not-an-id`, org.owner.cookie, {
        status: "SUSPENDED",
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe("DELETE /organizations/current/members/:id", () => {
  it("removes a member and drops them from the directory", async () => {
    const org = await withOrg();
    const member = await actor();
    const membershipId = await addMember(org, member, "MEMBER");

    const response = await deleteMemberRoute(
      send("DELETE", `${MEMBERS}/${membershipId}`, org.owner.cookie),
    );

    expect(response.status).toBe(200);
    const reloaded = await MembershipModel.findById(membershipId);
    expect(reloaded?.deletedAt).not.toBeNull();

    const list = await listMembersRoute(get(MEMBERS, org.owner.cookie));
    expect((await envelope<MemberView[]>(list)).data).toHaveLength(1);
  });

  it("refuses to remove the last owner", async () => {
    const org = await withOrg();
    const membershipId = await ownMembershipId(org, org.owner.userId);

    const response = await deleteMemberRoute(
      send("DELETE", `${MEMBERS}/${membershipId}`, org.owner.cookie),
    );

    expect(response.status).toBe(409);
  });

  it("refuses a viewer with 403", async () => {
    const org = await withOrg();
    const viewer = await actor();
    await addMember(org, viewer, "VIEWER");
    const member = await actor();
    const membershipId = await addMember(org, member, "MEMBER");

    const response = await deleteMemberRoute(
      send("DELETE", `${MEMBERS}/${membershipId}`, viewer.cookie),
    );

    expect(response.status).toBe(403);
  });
});

describe("POST /organizations/current/leave", () => {
  it("lets a member leave the organisation", async () => {
    const org = await withOrg();
    const member = await actor();
    const membershipId = await addMember(org, member, "MEMBER");

    const response = await leaveRoute(send("POST", LEAVE, member.cookie));

    expect(response.status).toBe(200);
    const reloaded = await MembershipModel.findById(membershipId);
    expect(reloaded?.deletedAt).not.toBeNull();
  });

  it("refuses the last owner", async () => {
    const org = await withOrg();

    const response = await leaveRoute(send("POST", LEAVE, org.owner.cookie));

    expect(response.status).toBe(409);
  });

  it("refuses a caller with no session", async () => {
    const response = await leaveRoute(
      new Request(`${ORIGIN}${LEAVE}`, {
        method: "POST",
        headers: { origin: ORIGIN },
      }),
    );
    expect(response.status).toBe(401);
  });
});
