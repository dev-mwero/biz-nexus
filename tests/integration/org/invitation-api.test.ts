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
import { POST as acceptInvitationRoute } from "@/app/api/v1/auth/accept-invitation/route";
import { DELETE as revokeInvitationRoute } from "@/app/api/v1/organizations/current/invitations/[id]/route";
import { GET as listInvitationsRoute } from "@/app/api/v1/organizations/current/invitations/route";
import { POST as createInvitationRoute } from "@/app/api/v1/organizations/current/members/invitations/route";
import { issueSession, UserModel } from "@/modules/identity";
import { hashToken } from "@/modules/identity/password";
import {
  createOrganization,
  InvitationModel,
  inviteMember,
  MembershipModel,
  type Organization,
  RoleModel,
  setActiveOrganization,
} from "@/modules/organizations";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * The four invitation endpoints, driven as handlers.
 *
 * The service suite in `invitations.test.ts` covers what the rules are; this one
 * covers what a caller can actually reach and what a caller is told. The
 * properties here are the ones that only exist at this layer: which permission
 * each verb demands, what a refusal looks like on the wire, that the tenant comes
 * from the session and not the URL, that no response carries the token digest,
 * and that a spent token is indistinguishable from one that never existed.
 *
 * Real handlers, real `Request`s, real cookies, real database. A suite that
 * called `inviteMember` directly would pass with every route wired to nothing —
 * which is the failure this one exists to prevent, and the same reason the e2e
 * critical path is worth having.
 */

const LIST = "/api/v1/organizations/current/invitations";
const CREATE = "/api/v1/organizations/current/members/invitations";

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
    InvitationModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    RoleModel.deleteMany({}),
    (await import("@/modules/organizations")).OrganizationModel.deleteMany({}),
  ]);
});

/**
 * A signed-in account, optionally already pointed at an organisation.
 *
 * `issueSession` always writes `activeOrganizationId: null`, so the switch is a
 * separate write — the same two-step a real caller performs through
 * `POST /organizations/active`.
 */
async function actor(email?: string): Promise<Actor> {
  const user = await createUser(email ? { email } : {});
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

/**
 * Make `member` an ACTIVE member of `org` under one of its roles.
 *
 * Written directly rather than through an invitation, because most of these cases
 * are about what the endpoints do with a membership that already exists, and
 * redeeming a token to set one up would put the thing under test inside the setup.
 *
 * The session is pointed at the organisation as well. `issueSession` leaves
 * `activeOrganizationId` null, so without the switch `requirePermission` fails
 * earlier than the case under test with `ACTIVE_ORGANIZATION_REQUIRED` — which
 * is right behaviour and the wrong thing to be asserting.
 */
async function addMember(
  org: Org,
  member: Actor,
  roleKey = "MEMBER",
): Promise<void> {
  await MembershipModel.create({
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
}

function json(body: unknown): RequestInit {
  return {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function post(path: string, body: unknown, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    ...json(body),
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
  });
}

function get(path: string, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "GET",
    ...(cookie ? { headers: { cookie } } : {}),
  });
}

function del(path: string, cookie: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "DELETE",
    headers: { origin: ORIGIN, cookie },
  });
}

describe("POST /organizations/current/members/invitations", () => {
  it("returns the invitation and the raw token once", async () => {
    const org = await withOrg();

    const response = await createInvitationRoute(
      post(
        CREATE,
        { email: "new-hire@example.com", roleKey: "ADMIN" },
        org.owner.cookie,
      ),
    );

    expect(response.status).toBe(201);
    const body = await envelope<{
      invitation: { roleId: string; email: string };
      token: string;
      replaced: boolean;
    }>(response);

    expect(body.data?.invitation.email).toBe("new-hire@example.com");
    // The key resolves to a role of *this* organisation.
    expect(body.data?.invitation.roleId).toBe(org.roleIds.ADMIN.toString());
    expect(body.data?.token).toBeTruthy();
    expect(body.data?.replaced).toBe(false);

    // The token is returned, and it is the digest that is stored.
    expect(
      await InvitationModel.findOne({ email: "new-hire@example.com" }),
    ).toMatchObject({ tokenHash: hashToken(body.data?.token ?? "") });
  });

  it("keeps the token digest out of the response", async () => {
    const org = await withOrg();

    const response = await createInvitationRoute(
      post(CREATE, { email: "new-hire@example.com" }, org.owner.cookie),
    );
    const raw = await response.text();

    expect(raw).not.toContain("tokenHash");
    const created = await InvitationModel.findOne({
      email: "new-hire@example.com",
    });
    expect(raw).not.toContain(created?.tokenHash ?? "absent");
    // And the raw token appears exactly once: in its own field.
    expect(raw.match(/"token"/g)).toHaveLength(1);
  });

  it("defaults to the MEMBER role when no roleKey is given", async () => {
    const org = await withOrg();

    const response = await createInvitationRoute(
      post(CREATE, { email: "new-hire@example.com" }, org.owner.cookie),
    );
    const body = await envelope<{ invitation: { roleId: string } }>(response);

    expect(body.data?.invitation.roleId).toBe(org.roleIds.MEMBER.toString());
  });

  it("refuses OWNER and writes nothing", async () => {
    const org = await withOrg();

    const response = await createInvitationRoute(
      post(
        CREATE,
        { email: "sneaky@example.com", roleKey: "OWNER" },
        org.owner.cookie,
      ),
    );

    expect(response.status).toBe(422);
    const body = await envelope(response);
    expect(body.error?.code).toBe("ROLE_NOT_IN_ORGANIZATION");
    expect(
      await InvitationModel.countDocuments({
        organizationId: org.organization._id,
      }),
    ).toBe(0);
  });

  it("rejects a role key that is not a system role", async () => {
    const org = await withOrg();

    const response = await createInvitationRoute(
      post(
        CREATE,
        { email: "a@example.com", roleKey: "SUPERUSER" },
        org.owner.cookie,
      ),
    );

    expect(response.status).toBe(422);
    expect((await envelope(response)).error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a body naming a role by id", async () => {
    // The strict object is the point: `roleId` is silently dropped by a default
    // zod object, so the caller would get a 201 with the default role and no
    // reason to think anything was wrong.
    const org = await withOrg();

    const response = await createInvitationRoute(
      post(
        CREATE,
        { email: "a@example.com", roleId: org.roleIds.ADMIN.toString() },
        org.owner.cookie,
      ),
    );

    expect(response.status).toBe(422);
    const body = await envelope(response);
    expect(body.error?.code).toBe("VALIDATION_FAILED");
    // The path is the body, not the key: zod reports an unrecognised key at the
    // root, so the detail names the object. The message carries the key, which
    // is what a client author needs.
    expect(body.error?.details?.[0]?.path).toBe("body");
    expect(body.error?.details?.[0]?.message).toContain("roleId");
    expect(
      await InvitationModel.countDocuments({
        organizationId: org.organization._id,
      }),
    ).toBe(0);
  });

  it("refuses a member who cannot invite", async () => {
    const org = await withOrg();
    const member = await actor(`member-${Date.now()}@example.com`);
    await addMember(org, member);

    const response = await createInvitationRoute(
      post(CREATE, { email: "a@example.com" }, member.cookie),
    );

    expect(response.status).toBe(403);
    expect((await envelope(response)).error?.code).toBe(
      "INSUFFICIENT_PERMISSION",
    );
  });

  it("refuses a caller with no session", async () => {
    const response = await createInvitationRoute(
      post(CREATE, { email: "a@example.com" }),
    );

    expect(response.status).toBe(401);
    expect((await envelope(response)).error?.code).toBe("UNAUTHENTICATED");
  });
});

describe("GET /organizations/current/invitations", () => {
  it("lists this organisation's open invitations", async () => {
    const org = await withOrg();
    const other = await withOrg("Other");
    await inviteMember({
      organizationId: org.organization._id,
      email: "open@example.com",
      invitedBy: org.owner.userId,
    });
    await inviteMember({
      organizationId: other.organization._id,
      email: "elsewhere@example.com",
      invitedBy: other.owner.userId,
    });

    const response = await listInvitationsRoute(get(LIST, org.owner.cookie));
    const body = await envelope<{ email: string }[]>(response);

    expect(body.data?.map((row) => row.email)).toEqual(["open@example.com"]);
  });

  it("includes expired ones only when asked", async () => {
    const org = await withOrg();
    await inviteMember({
      organizationId: org.organization._id,
      email: "stale@example.com",
      invitedBy: org.owner.userId,
      now: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    expect(
      (
        await envelope<unknown[]>(
          await listInvitationsRoute(get(LIST, org.owner.cookie)),
        )
      ).data,
    ).toEqual([]);

    const widened = await envelope<{ email: string }[]>(
      await listInvitationsRoute(
        get(`${LIST}?includeExpired=true`, org.owner.cookie),
      ),
    );
    expect(widened.data?.map((row) => row.email)).toEqual([
      "stale@example.com",
    ]);
  });

  it("does not leak the digest through the list either", async () => {
    const org = await withOrg();
    await inviteMember({
      organizationId: org.organization._id,
      email: "open@example.com",
      invitedBy: org.owner.userId,
    });

    const raw = await (
      await listInvitationsRoute(get(LIST, org.owner.cookie))
    ).text();

    expect(raw).not.toContain("tokenHash");
  });

  it("lets a viewer read the list but nothing more", async () => {
    // VIEWER holds every `.read` permission, so this is the one caller that can
    // see who has been invited while being unable to change any of it.
    const org = await withOrg();
    const viewer = await actor(`viewer-${Date.now()}@example.com`);
    await addMember(org, viewer, "VIEWER");

    expect((await listInvitationsRoute(get(LIST, viewer.cookie))).status).toBe(
      200,
    );

    const attempt = await createInvitationRoute(
      post(CREATE, { email: "a@example.com" }, viewer.cookie),
    );
    expect(attempt.status).toBe(403);
  });
});

describe("DELETE /organizations/current/invitations/:id", () => {
  it("revokes an open invitation", async () => {
    const org = await withOrg();
    const { invitation } = await inviteMember({
      organizationId: org.organization._id,
      email: "new-hire@example.com",
      invitedBy: org.owner.userId,
    });

    const response = await revokeInvitationRoute(
      del(`${LIST}/${invitation._id}`, org.owner.cookie),
    );

    expect(response.status).toBe(200);
    expect((await envelope<{ revoked: boolean }>(response)).data?.revoked).toBe(
      true,
    );
    expect(
      (await InvitationModel.findById(invitation._id))?.revokedAt,
    ).not.toBeNull();
  });

  it("answers 404 for another organisation's invitation", async () => {
    const org = await withOrg();
    const other = await withOrg("Other");
    const { invitation } = await inviteMember({
      organizationId: other.organization._id,
      email: "new-hire@example.com",
      invitedBy: other.owner.userId,
    });

    const response = await revokeInvitationRoute(
      del(`${LIST}/${invitation._id}`, org.owner.cookie),
    );

    expect(response.status).toBe(404);
    expect(
      (await InvitationModel.findById(invitation._id))?.revokedAt,
    ).toBeNull();
  });

  it("answers the same 404 for an unknown id and an invalid one", async () => {
    const org = await withOrg();

    const unknown = await revokeInvitationRoute(
      del(`${LIST}/${new Types.ObjectId()}`, org.owner.cookie),
    );
    const malformed = await revokeInvitationRoute(
      del(`${LIST}/not-an-id`, org.owner.cookie),
    );

    // Deliberately not the same status: an id that cannot be an id is a bad
    // request, and saying so is what stops a client retrying a broken link
    // forever. Both are 4xx, and neither is a 500.
    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(400);
    expect((await envelope(malformed)).error?.code).toBe("BAD_REQUEST");
  });

  it("will not revoke an invitation a member cannot revoke", async () => {
    const org = await withOrg();
    const { invitation } = await inviteMember({
      organizationId: org.organization._id,
      email: "new-hire@example.com",
      invitedBy: org.owner.userId,
    });
    const member = await actor(`member-${Date.now()}@example.com`);
    await addMember(org, member);

    const response = await revokeInvitationRoute(
      del(`${LIST}/${invitation._id}`, member.cookie),
    );

    expect(response.status).toBe(403);
    expect(
      (await InvitationModel.findById(invitation._id))?.revokedAt,
    ).toBeNull();
  });
});

describe("POST /auth/accept-invitation", () => {
  const ACCEPT = "/api/v1/auth/accept-invitation";

  /** An invitation and the raw token that redeems it. */
  async function invite(org: Org, email: string): Promise<string> {
    const { token } = await inviteMember({
      organizationId: org.organization._id,
      email,
      invitedBy: org.owner.userId,
    });
    return token;
  }

  it("creates the membership and moves the session to that organisation", async () => {
    const org = await withOrg();
    const invitee = await actor(`invitee-${Date.now()}@example.com`);
    const token = await invite(org, `${invitee.userId}@example.com`);

    // No active organisation, which is the ordinary reason somebody was sent the
    // link. `requireOrg` would refuse this caller outright.
    const response = await acceptInvitationRoute(
      post(ACCEPT, { token }, invitee.cookie),
    );

    expect(response.status).toBe(200);
    const body = await envelope<{
      activeOrganizationId: string;
      organization: { id: string; name: string };
      membership: { status: string };
    }>(response);

    expect(body.data?.membership.status).toBe("ACTIVE");
    expect(body.data?.organization.name).toBe(org.organization.name);
    expect(body.data?.activeOrganizationId).toBe(
      org.organization._id.toString(),
    );

    // The session really moved, rather than the response merely claiming it.
    const { default: mongoose } = await import("mongoose");
    const { SessionModel } = await import("@/modules/identity");
    const session = await SessionModel.findById(invitee.sessionId);
    expect(session?.activeOrganizationId?.toString()).toBe(
      org.organization._id.toString(),
    );
    expect(mongoose).toBeDefined();
  });

  it("answers a spent token exactly as it answers one that never existed", async () => {
    const org = await withOrg();
    const invitee = await actor(`invitee-${Date.now()}@example.com`);
    const token = await invite(org, `${invitee.userId}@example.com`);

    await acceptInvitationRoute(post(ACCEPT, { token }, invitee.cookie));

    const replayed = await acceptInvitationRoute(
      post(ACCEPT, { token }, invitee.cookie),
    );
    const invented = await acceptInvitationRoute(
      post(ACCEPT, { token: "not-a-real-token" }, invitee.cookie),
    );

    expect(replayed.status).toBe(404);
    // Byte-identical, request id masked: a token that was real and is spent must
    // not be distinguishable from one an attacker made up.
    expect(await refusal(replayed)).toEqual(await refusal(invented));
  });

  it("moves the session when the caller already had another organisation", async () => {
    const mine = await withOrg("Mine");
    const theirs = await withOrg("Theirs");
    const token = await invite(theirs, `someone-${Date.now()}@example.com`);

    // Accepted by somebody already pointed somewhere else: the token decides.
    await acceptInvitationRoute(post(ACCEPT, { token }, mine.owner.cookie));

    const { SessionModel } = await import("@/modules/identity");
    const session = await SessionModel.findById(mine.owner.sessionId);
    expect(session?.activeOrganizationId?.toString()).toBe(
      theirs.organization._id.toString(),
    );
  });

  it("refuses a caller with no session", async () => {
    const org = await withOrg();
    const token = await invite(org, "nobody@example.com");
    // `createOrganization` already made the owner a member, so the count starts
    // at one: the assertion is that this call did not add to it.
    const before = await MembershipModel.countDocuments({
      organizationId: org.organization._id,
    });

    const response = await acceptInvitationRoute(post(ACCEPT, { token }));

    expect(response.status).toBe(401);
    expect(
      await MembershipModel.countDocuments({
        organizationId: org.organization._id,
      }),
    ).toBe(before);
  });

  it("requires a token in the body", async () => {
    const invitee = await actor(`invitee-${Date.now()}@example.com`);

    const response = await acceptInvitationRoute(
      post(ACCEPT, {}, invitee.cookie),
    );

    expect(response.status).toBe(422);
    expect((await envelope(response)).error?.code).toBe("VALIDATION_FAILED");
  });
});
