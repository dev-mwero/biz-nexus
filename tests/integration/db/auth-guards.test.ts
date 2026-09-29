import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { SessionModel, type User, UserModel } from "@/modules/identity";
import { hashPassword } from "@/modules/identity/password";
import { issueSession } from "@/modules/identity/session.service";
import {
  ActiveOrganizationError,
  InvitationModel,
  MembershipModel,
  OrganizationModel,
  RoleModel,
  setActiveOrganization,
} from "@/modules/organizations";
import type { Permission } from "@/modules/rbac/permissions";
import { type AuthContext, createAuthGuards } from "@/shared/auth/dal";

const PASSWORD = "correct horse battery staple";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    OrganizationModel.deleteMany({}),
    RoleModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    InvitationModel.deleteMany({}),
  ]);
});

interface Fixture {
  owner: User;
  org: { _id: Types.ObjectId; slug: string };
  otherOrg: { _id: Types.ObjectId; slug: string };
  ownerRoleId: Types.ObjectId;
  viewerRoleId: Types.ObjectId;
  otherOrgRoleId: Types.ObjectId;
  sessionToken: string;
  sessionId: Types.ObjectId;
}

/** A signed-in owner with `permissions` in one org, plus a second org they are not in. */
async function seed(permissions: Permission[]): Promise<Fixture> {
  const owner = await UserModel.create({
    email: `owner-${new Types.ObjectId()}@example.com`,
    name: "Owner",
    passwordHash: await hashPassword(PASSWORD),
  });

  const org = await OrganizationModel.create({
    name: "Acme",
    slug: `acme-${new Types.ObjectId()}`,
    createdBy: owner._id,
  });
  const otherOrg = await OrganizationModel.create({
    name: "Globex",
    slug: `globex-${new Types.ObjectId()}`,
    createdBy: owner._id,
  });

  const ownerRole = await RoleModel.create({
    organizationId: org._id,
    key: "OWNER",
    name: "Owner",
    permissions,
    isSystem: true,
  });
  const viewerRole = await RoleModel.create({
    organizationId: org._id,
    key: "VIEWER",
    name: "Viewer",
    permissions: [],
    isSystem: true,
  });
  // A role that genuinely belongs to the second organization. Pointing a
  // membership there at a role owned by the first is refused by the DAL, which
  // is the integrity rule the cross-tenant tests below rely on.
  const otherOrgRole = await RoleModel.create({
    organizationId: otherOrg._id,
    key: "ADMIN",
    name: "Admin",
    permissions: ["deals.delete"],
    isSystem: true,
  });

  await MembershipModel.create({
    organizationId: org._id,
    userId: owner._id,
    roleId: ownerRole._id,
    status: "ACTIVE",
  });

  const { token, session } = await issueSession({ userId: owner._id });
  await SessionModel.updateOne(
    { _id: session._id },
    { $set: { activeOrganizationId: org._id } },
  );

  return {
    owner,
    org,
    otherOrg,
    ownerRoleId: ownerRole._id,
    viewerRoleId: viewerRole._id,
    otherOrgRoleId: otherOrgRole._id,
    sessionToken: token,
    sessionId: session._id,
  };
}

const guardsFor = (token: string | null) => createAuthGuards(async () => token);

async function expectAuthError(
  promise: Promise<unknown>,
  code: string,
  status: number,
) {
  await expect(promise).rejects.toMatchObject({
    name: "AuthError",
    code,
    status,
  });
}

describe("getSession", () => {
  it("resolves a valid token", async () => {
    const f = await seed(["deals.read"]);

    const session = await guardsFor(f.sessionToken).getSession();

    expect(session?.userId).toEqual(f.owner._id);
  });

  it("returns null for a missing, unknown or revoked token", async () => {
    const f = await seed(["deals.read"]);
    const { revokeSessionToken } = await import(
      "@/modules/identity/session.service"
    );

    expect(await guardsFor(null).getSession()).toBeNull();
    expect(await guardsFor("nonsense").getSession()).toBeNull();

    await revokeSessionToken(f.sessionToken);
    expect(await guardsFor(f.sessionToken).getSession()).toBeNull();
  });
});

describe("requireUser", () => {
  it("returns the user behind a live session", async () => {
    const f = await seed(["deals.read"]);

    const user = await guardsFor(f.sessionToken).requireUser();

    expect(user._id).toEqual(f.owner._id);
  });

  it("throws 401 without a session", async () => {
    await expectAuthError(
      guardsFor(null).requireUser(),
      "UNAUTHENTICATED",
      401,
    );
  });

  it("throws 401 for a suspended user, even with a valid session", async () => {
    // The session outlives the suspension otherwise, and every suspended user
    // would keep working until their token expired.
    const f = await seed(["deals.read"]);
    await UserModel.updateOne(
      { _id: f.owner._id },
      { $set: { status: "SUSPENDED" } },
    );

    await expectAuthError(
      guardsFor(f.sessionToken).requireUser(),
      "UNAUTHENTICATED",
      401,
    );
  });
});

describe("requireOrg", () => {
  it("resolves the organization recorded on the session", async () => {
    const f = await seed(["deals.read"]);

    const context = await guardsFor(f.sessionToken).requireOrg();

    expect(context.organization._id).toEqual(f.org._id);
    expect(context.user._id).toEqual(f.owner._id);
    expect(context.role._id).toEqual(f.ownerRoleId);
  });

  it("throws 403 when the session has no active organization", async () => {
    // A new user, or one removed from every organization. A normal state, and
    // the guards decide what it means.
    const f = await seed(["deals.read"]);
    await SessionModel.updateOne(
      { _id: f.sessionId },
      { $set: { activeOrganizationId: null } },
    );

    await expectAuthError(
      guardsFor(f.sessionToken).requireOrg(),
      "ACTIVE_ORGANIZATION_REQUIRED",
      403,
    );
  });

  it("throws 403 when the user is not an active member of the active org", async () => {
    const f = await seed(["deals.read"]);
    await SessionModel.updateOne(
      { _id: f.sessionId },
      { $set: { activeOrganizationId: f.otherOrg._id } },
    );

    await expectAuthError(
      guardsFor(f.sessionToken).requireOrg(),
      "ACTIVE_ORGANIZATION_REQUIRED",
      403,
    );
  });

  it("refuses a membership that is INVITED rather than ACTIVE", async () => {
    // An open invitation is not access.
    const f = await seed(["deals.read"]);
    await MembershipModel.updateOne(
      { userId: f.owner._id },
      { $set: { status: "INVITED" } },
    );

    await expectAuthError(
      guardsFor(f.sessionToken).requireOrg(),
      "ACTIVE_ORGANIZATION_REQUIRED",
      403,
    );
  });

  it("refuses a suspended membership", async () => {
    const f = await seed(["deals.read"]);
    await MembershipModel.updateOne(
      { userId: f.owner._id },
      { $set: { status: "SUSPENDED" } },
    );

    await expectAuthError(
      guardsFor(f.sessionToken).requireOrg(),
      "ACTIVE_ORGANIZATION_REQUIRED",
      403,
    );
  });

  it("refuses a soft-deleted membership", async () => {
    const f = await seed(["deals.read"]);
    await MembershipModel.updateOne(
      { userId: f.owner._id },
      { $set: { deletedAt: new Date() } },
    );

    await expectAuthError(
      guardsFor(f.sessionToken).requireOrg(),
      "ACTIVE_ORGANIZATION_REQUIRED",
      403,
    );
  });

  it("refuses a deactivated organization", async () => {
    const f = await seed(["deals.read"]);
    await OrganizationModel.updateOne(
      { _id: f.org._id },
      { $set: { isActive: false } },
    );

    await expectAuthError(
      guardsFor(f.sessionToken).requireOrg(),
      "ACTIVE_ORGANIZATION_REQUIRED",
      403,
    );
  });

  it("throws 401, not 403, when there is no session at all", async () => {
    // 403 for a bad token would confirm that something is being looked up.
    await expectAuthError(guardsFor(null).requireOrg(), "UNAUTHENTICATED", 401);
  });
});

describe("requirePermission", () => {
  it("allows a permission the role holds and returns the context", async () => {
    const f = await seed(["deals.read", "deals.update"]);

    const context = await guardsFor(f.sessionToken).requirePermission(
      "deals.update",
    );

    expect(context.organization._id).toEqual(f.org._id);
    expect(context.membership.userId).toEqual(f.owner._id);
  });

  it("denies a permission the role does not hold", async () => {
    const f = await seed(["deals.read"]);

    await expectAuthError(
      guardsFor(f.sessionToken).requirePermission("deals.delete"),
      "INSUFFICIENT_PERMISSION",
      403,
    );
  });

  it("denies everything for a role with no permissions", async () => {
    const f = await seed(["deals.read"]);
    await RoleModel.updateOne(
      { _id: f.ownerRoleId },
      { $set: { permissions: [] } },
    );

    await expectAuthError(
      guardsFor(f.sessionToken).requirePermission("deals.read"),
      "INSUFFICIENT_PERMISSION",
      403,
    );
  });

  it("denies a permission code that is not in the catalogue", async () => {
    // Reached from JSON, where TypeScript does not apply. Deny rather than
    // compare against a list the code was never in.
    const f = await seed(["deals.read"]);

    await expectAuthError(
      guardsFor(f.sessionToken).requirePermission(
        "deals.explode" as unknown as Permission,
      ),
      "INSUFFICIENT_PERMISSION",
      403,
    );
  });

  it("denies by default when the role's permission list holds a stale code", async () => {
    const f = await seed([]);
    await RoleModel.updateOne(
      { _id: f.ownerRoleId },
      { $set: { permissions: ["Deals.Read", "deals.read "] } },
    );

    await expectAuthError(
      guardsFor(f.sessionToken).requirePermission("deals.read"),
      "INSUFFICIENT_PERMISSION",
      403,
    );
  });

  it("refuses a role belonging to another organization", async () => {
    // MongoDB has no foreign keys, so nothing stops a membership pointing at
    // another tenant's role. Without this check, that membership would grant
    // the permissions of a role this organisation does not own.
    const f = await seed(["deals.read"]);
    const foreignRole = await RoleModel.create({
      organizationId: f.otherOrg._id,
      key: "FOREIGN",
      name: "Foreign role",
      permissions: ["deals.delete"],
    });
    await MembershipModel.updateOne(
      { userId: f.owner._id },
      { $set: { roleId: foreignRole._id } },
    );

    await expectAuthError(
      guardsFor(f.sessionToken).requirePermission("deals.read"),
      "ACTIVE_ORGANIZATION_REQUIRED",
      403,
    );
  });

  it("refuses a soft-deleted role", async () => {
    const f = await seed(["deals.read"]);
    await RoleModel.updateOne(
      { _id: f.ownerRoleId },
      { $set: { deletedAt: new Date() } },
    );

    await expectAuthError(
      guardsFor(f.sessionToken).requirePermission("deals.read"),
      "ACTIVE_ORGANIZATION_REQUIRED",
      403,
    );
  });

  it("refuses a role that no longer exists", async () => {
    const f = await seed(["deals.read"]);
    await RoleModel.deleteMany({});

    await expectAuthError(
      guardsFor(f.sessionToken).requirePermission("deals.read"),
      "ACTIVE_ORGANIZATION_REQUIRED",
      403,
    );
  });
});

describe("cross-tenant isolation", () => {
  it("a user who is a member of both orgs still gets only the active org's role", async () => {
    // The strongest case, from docs/SECURITY.md §6: implementations that "scope
    // by the user's current org" look correct until the user is entitled to
    // more than one organisation.
    const f = await seed(["deals.read"]);

    const guest = await MembershipModel.create({
      organizationId: f.otherOrg._id,
      userId: f.owner._id,
      roleId: f.otherOrgRoleId,
      status: "ACTIVE",
    });
    expect(guest).toBeTruthy();

    // The session is on `org`, so the viewer role in `otherOrg` is irrelevant.
    await expectAuthError(
      guardsFor(f.sessionToken).requirePermission("deals.delete"),
      "INSUFFICIENT_PERMISSION",
      403,
    );

    // And the permission the other org's role does have still resolves to the
    // active org's role, not the one found by scanning.
    const context = await guardsFor(f.sessionToken).requirePermission(
      "deals.read",
    );
    expect(context.organization._id).toEqual(f.org._id);
    expect(context.role._id).toEqual(f.ownerRoleId);
  });

  it("does not honour an organizationId that is not on the session", async () => {
    // There is no parameter here to try, which is the property being asserted.
    // The organization comes from the session and nowhere else.
    const f = await seed(["deals.read"]);

    const context = await guardsFor(f.sessionToken).requireOrg();
    expect(context.organization._id).toEqual(f.org._id);
    expect(context.organization._id).not.toEqual(f.otherOrg._id);
  });
});

describe("setActiveOrganization", () => {
  it("switches to an organization the user is an active member of", async () => {
    const f = await seed(["deals.read"]);
    await MembershipModel.create({
      organizationId: f.otherOrg._id,
      userId: f.owner._id,
      roleId: f.otherOrgRoleId,
      status: "ACTIVE",
    });

    const session = await setActiveOrganization(f.sessionId, f.otherOrg._id);

    expect(session.activeOrganizationId).toEqual(f.otherOrg._id);
  });

  it("refuses an organization the user is not a member of", async () => {
    const f = await seed(["deals.read"]);

    await expect(
      setActiveOrganization(f.sessionId, f.otherOrg._id),
    ).rejects.toBeInstanceOf(ActiveOrganizationError);
  });

  it("refuses a membership that is only INVITED", async () => {
    const f = await seed(["deals.read"]);
    await MembershipModel.create({
      organizationId: f.otherOrg._id,
      userId: f.owner._id,
      roleId: f.otherOrgRoleId,
      status: "INVITED",
    });

    // Same answer as an unknown id. There is no way to tell "invited" from
    // "never existed" from here, which is the point.
    await expect(
      setActiveOrganization(f.sessionId, f.otherOrg._id),
    ).rejects.toMatchObject({
      code: "ORGANIZATION_UNAVAILABLE",
    });
  });

  it("answers identically for an unknown id and a forbidden one", async () => {
    // Otherwise the endpoint is an oracle for which organization ids exist.
    const f = await seed(["deals.read"]);

    // `allSettled` rather than two `await expect(p).rejects` calls. Written the
    // other way, both promises start before either has a handler attached, and a
    // rejection during the database round-trip escapes as an unhandled rejection
    // before `expect` gets to observe it. Node reports it as a false failure
    // attributed to whichever test was running, which is why this looked
    // intermittent and appeared to come from unrelated files.
    const [unknown, forbidden] = await Promise.allSettled([
      setActiveOrganization(f.sessionId, new Types.ObjectId()),
      setActiveOrganization(f.sessionId, f.otherOrg._id),
    ]);

    // Both must fail, and fail the same way, or one of them is distinguishable.
    expect(unknown.status).toBe("rejected");
    expect(forbidden.status).toBe("rejected");

    const unknownError = (unknown as PromiseRejectedResult).reason;
    const forbiddenError = (forbidden as PromiseRejectedResult).reason;

    expect(unknownError).toMatchObject({ code: "ORGANIZATION_UNAVAILABLE" });
    expect(forbiddenError).toMatchObject({ code: "ORGANIZATION_UNAVAILABLE" });
    // Identical, not merely similar: a differing message or status is exactly
    // the oracle this test exists to forbid.
    expect(unknownError).toEqual(forbiddenError);
  });

  it("refuses a deactivated organization", async () => {
    const f = await seed(["deals.read"]);
    await OrganizationModel.updateOne(
      { _id: f.org._id },
      { $set: { isActive: false } },
    );

    await expect(
      setActiveOrganization(f.sessionId, f.org._id),
    ).rejects.toMatchObject({
      code: "ORGANIZATION_UNAVAILABLE",
    });
  });

  it("takes effect on the next guard, without re-issuing the session", async () => {
    const f = await seed(["deals.read"]);
    await MembershipModel.create({
      organizationId: f.otherOrg._id,
      userId: f.owner._id,
      roleId: f.otherOrgRoleId,
      status: "ACTIVE",
    });

    await setActiveOrganization(f.sessionId, f.otherOrg._id);

    // Same token, new context. This is why the DAL re-reads membership on every
    // request rather than trusting what was true when the session was created.
    const context = await guardsFor(f.sessionToken).requireOrg();
    expect(context.organization._id).toEqual(f.otherOrg._id);
    expect(context.role._id).toEqual(f.otherOrgRoleId);
  });
});

describe("guards are composable", () => {
  it("returns a context usable for the rest of the request", async () => {
    const f = await seed(["contacts.read"]);

    const context: AuthContext = await guardsFor(
      f.sessionToken,
    ).requirePermission("contacts.read");

    expect(context.session.userId).toEqual(f.owner._id);
    expect(context.user.email).toBe(f.owner.email);
    expect(context.organization.slug).toBe(f.org.slug);
    expect(context.membership.organizationId).toEqual(f.org._id);
    expect(context.role.permissions).toContain("contacts.read");
  });
});
