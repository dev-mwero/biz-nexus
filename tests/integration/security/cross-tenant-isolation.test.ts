import { Types } from "mongoose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { createAuthGuards } from "@/shared/auth/dal";

/**
 * The cross-tenant matrix, at the service layer.
 *
 * tests/integration/db/tenant-isolation.test.ts already covers the repository
 * thoroughly, including the owner-of-both case, so this file deliberately does
 * not repeat it. What it covers is the layer above: the guards and services
 * added in 1.15, which reach MongoDB through Mongoose models and the DAL rather
 * than through a repository, and which therefore have their own way of getting
 * isolation wrong.
 *
 * That way is straightforward to get wrong. Every check in a guard is a
 * question about the user — is this account active, do they hold a permission,
 * are they a member — and none of those questions mentions the tenant. A guard
 * that verifies the user thoroughly and then looks up a record by id would
 * pass every user-shaped test in the suite and still hand over another
 * organisation's data.
 *
 * The centrepiece is the Owner-of-both case, as SECURITY.md requires. The caller
 * below is Owner of *both* organisations, so every membership and permission
 * check available to the application returns true. Only the tenant scope can
 * refuse, which is the only reason these tests can distinguish a real
 * implementation from a plausible one.
 */

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

interface World {
  /** Owner of BOTH organisations, session active in Acme. */
  user: User;
  acme: Types.ObjectId;
  globex: Types.ObjectId;
  initech: Types.ObjectId;
  sessionToken: string;
  sessionId: Types.ObjectId;
  globexRoleId: Types.ObjectId;
  acmeRoleId: Types.ObjectId;
}

async function seedOwnerOfBoth(): Promise<World> {
  const user = await UserModel.create({
    email: `both-${new Types.ObjectId()}@example.com`,
    name: "Owner of both",
    passwordHash: await hashPassword(PASSWORD),
  });

  const acme = await OrganizationModel.create({
    name: "Acme",
    slug: `acme-${new Types.ObjectId()}`,
    createdBy: user._id,
  });
  const globex = await OrganizationModel.create({
    name: "Globex",
    slug: `globex-${new Types.ObjectId()}`,
    createdBy: user._id,
  });
  // A third organisation this user has nothing to do with, to tell "refused
  // because you are not a member" apart from "refused because it does not
  // exist".
  const initech = await OrganizationModel.create({
    name: "Initech",
    slug: `initech-${new Types.ObjectId()}`,
    createdBy: new Types.ObjectId(),
  });

  // Full permissions in both. Every authorisation question the application could
  // ask about this user has the answer it wants.
  const permissions = [
    "deals.create",
    "deals.delete",
    "members.invite",
  ] as const;

  const roleIds: Types.ObjectId[] = [];
  for (const org of [acme, globex]) {
    const role = await RoleModel.create({
      organizationId: org._id,
      key: "OWNER",
      name: "Owner",
      permissions: [...permissions],
      isSystem: true,
    });
    roleIds.push(role._id);
    await MembershipModel.create({
      organizationId: org._id,
      userId: user._id,
      roleId: role._id,
      status: "ACTIVE",
    });
  }

  const [acmeRoleId, globexRoleId] = roleIds;
  if (!acmeRoleId || !globexRoleId) {
    throw new Error("the fixture must create one role per organisation");
  }

  const { token, session } = await issueSession({ userId: user._id });
  await SessionModel.updateOne(
    { _id: session._id },
    { $set: { activeOrganizationId: acme._id } },
  );

  return {
    user,
    acme: acme._id,
    globex: globex._id,
    initech: initech._id,
    sessionToken: token,
    sessionId: session._id,
    acmeRoleId,
    globexRoleId,
  };
}

describe("cross-tenant isolation at the service layer", () => {
  let world: World;

  beforeEach(async () => {
    world = await seedOwnerOfBoth();
  });

  describe("the guards", () => {
    it("resolve the organisation from the session, and only from the session", async () => {
      const guards = createAuthGuards(async () => world.sessionToken);

      const ctx = await guards.requireOrg();
      expect(ctx.organization._id).toEqual(world.acme);
    });

    it("grant a permission the user holds in the active organisation", async () => {
      // A positive control. Without it, a guard that refused everything would
      // pass every negative case in this file and look secure.
      const guards = createAuthGuards(async () => world.sessionToken);

      await expect(
        guards.requirePermission("deals.create"),
      ).resolves.toBeDefined();
    });

    it("do not take an organisationId to be overridden with", async () => {
      // A type-level assertion, which is the only place this can be enforced.
      // SECURITY.md requires organizationId to be "stripped, not honoured" from
      // any request; at the guard boundary the stronger form holds — there is
      // no parameter to pass it in, so a request body cannot supply one.
      const guards = createAuthGuards(async () => world.sessionToken);

      // The assertion is the @ts-expect-error below: it fails the build if a
      // second parameter is ever added, and no runtime statement can check
      // that. A test body cannot express "this call is not allowed", so the
      // guarantee has to live in the type system.
      //
      const extraArgument = { organizationId: world.globex };
      const ctx =
        await // @ts-expect-error organizationId is not an accepted argument.
        guards.requirePermission("deals.create", extraArgument);

      // At runtime JavaScript ignores the surplus argument, and that is the
      // behaviour SECURITY.md asks for: an organizationId in a body is
      // "stripped, not honoured". The caller is still operating in the
      // session's own organisation, not the one the body named. This user is
      // Owner of both, so an implementation that did honour it would return
      // Globex here and the assertion would catch it.
      expect(ctx.organization._id).toEqual(world.acme);
    });

    it("refuse once the membership for the active organisation is revoked", async () => {
      // Takes effect on the next request, not when the session happens to
      // expire. The user is still Owner of Globex; that is not enough.
      await MembershipModel.updateMany(
        { organizationId: world.acme },
        { $set: { status: "REVOKED" } },
      );

      const guards = createAuthGuards(async () => world.sessionToken);
      await expect(guards.requireOrg()).rejects.toThrow();
      await expect(guards.requirePermission("deals.create")).rejects.toThrow();
    });
  });

  describe("switching active organisation", () => {
    it("is the one route to another organisation the user does hold a role in", async () => {
      await setActiveOrganization(world.sessionId, world.globex);

      const guards = createAuthGuards(async () => world.sessionToken);
      const ctx = await guards.requireOrg();
      expect(ctx.organization._id).toEqual(world.globex);
    });

    it("refuses an organisation the user is not a member of", async () => {
      await expect(
        setActiveOrganization(world.sessionId, world.initech),
      ).rejects.toBeInstanceOf(ActiveOrganizationError);
    });

    it("refuses an organisation that does not exist", async () => {
      await expect(
        setActiveOrganization(world.sessionId, new Types.ObjectId()),
      ).rejects.toBeInstanceOf(ActiveOrganizationError);
    });

    it("refuses a malformed id rather than throwing something unexpected", async () => {
      await expect(
        setActiveOrganization(world.sessionId, "not-an-object-id"),
      ).rejects.toBeInstanceOf(ActiveOrganizationError);
    });

    it("answers identically for a foreign organisation and a nonexistent one", async () => {
      // Not a stylistic point. Distinguishing them turns this endpoint into an
      // oracle for which organisation ids are real, and 1.22 will map both to
      // the same status.
      const foreign = await setActiveOrganization(
        world.sessionId,
        world.initech,
      ).catch((error: unknown) => error);
      const absent = await setActiveOrganization(
        world.sessionId,
        new Types.ObjectId(),
      ).catch((error: unknown) => error);

      expect(foreign).toBeInstanceOf(ActiveOrganizationError);
      expect(absent).toBeInstanceOf(ActiveOrganizationError);
      expect((foreign as ActiveOrganizationError).message).toBe(
        (absent as ActiveOrganizationError).message,
      );
    });

    it("leaves the session's active organisation unchanged after a refusal", async () => {
      await setActiveOrganization(world.sessionId, world.initech).catch(
        () => undefined,
      );

      const guards = createAuthGuards(async () => world.sessionToken);
      const ctx = await guards.requireOrg();
      expect(ctx.organization._id).toEqual(world.acme);
    });
  });

  describe("integrity, which MongoDB does not enforce for us", () => {
    it("refuses a membership that points at another organisation's role", async () => {
      // There is no foreign key here, so this document is writable and is
      // exactly the shape an attacker or a careless migration would produce. It
      // would otherwise hand the holder of an Acme membership the permissions
      // of a Globex role.
      // Repointing the existing membership rather than adding a second one:
      // {organizationId, userId} is unique, so the corruption has to be
      // introduced the way it would happen in practice - by an update that
      // nobody constrained.
      await MembershipModel.updateOne(
        { organizationId: world.acme, userId: world.user._id },
        { $set: { roleId: world.globexRoleId } },
      );

      const guards = createAuthGuards(async () => world.sessionToken);
      await expect(guards.requirePermission("deals.create")).rejects.toThrow();
    });

    it("refuses a membership for a user who is suspended", async () => {
      await UserModel.updateOne(
        { _id: world.user._id },
        { $set: { status: "SUSPENDED" } },
      );

      const guards = createAuthGuards(async () => world.sessionToken);
      await expect(guards.requireUser()).rejects.toThrow();
    });

    it("refuses a session for a deactivated organization", async () => {
      // isActive, not status: the organisation model carries a boolean, and a
      // test that set a `status` field would be a no-op that passes for the
      // wrong reason.
      await OrganizationModel.updateOne(
        { _id: world.acme },
        { $set: { isActive: false } },
      );

      const guards = createAuthGuards(async () => world.sessionToken);
      await expect(guards.requireOrg()).rejects.toThrow();
    });

    it("refuses a soft-deleted role even though the membership is active", async () => {
      await RoleModel.updateOne(
        { _id: world.acmeRoleId },
        { $set: { deletedAt: new Date() } },
      );

      const guards = createAuthGuards(async () => world.sessionToken);
      await expect(guards.requirePermission("deals.create")).rejects.toThrow();
    });
  });
});
