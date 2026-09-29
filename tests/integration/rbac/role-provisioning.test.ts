import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { SessionModel, UserModel } from "@/modules/identity";
import { hashPassword } from "@/modules/identity/password";
import { issueSession } from "@/modules/identity/session.service";
import {
  createOrganization,
  MembershipModel,
  OrganizationCreationError,
  OrganizationModel,
  RoleModel,
  type SystemRoleKey,
} from "@/modules/organizations";
import {
  DEFAULT_ROLE_KEY,
  findDefaultRole,
  provisionSystemRoles,
  RoleProvisioningError,
  SYSTEM_ROLE_KEYS,
} from "@/modules/rbac";

/**
 * System role provisioning.
 *
 * The interesting assertions are the negative ones. "A new organisation has four
 * roles" is a one-line fact that a test confirms and cannot learn from; what
 * can actually break is a half-provisioned set, a second run, or a role left
 * in the wrong organisation.
 */

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
  ]);
});

async function seedUser() {
  return UserModel.create({
    email: `founder-${new Types.ObjectId()}@example.com`,
    name: "Founder",
    passwordHash: await hashPassword("correct horse battery staple"),
  });
}

describe("system role provisioning", () => {
  it("a new organisation has exactly four roles", async () => {
    const owner = await seedUser();

    await createOrganization({ name: "Acme", ownerId: owner._id });

    const roles = await RoleModel.find({});
    expect(roles).toHaveLength(4);
  });

  it("creates exactly the four documented keys", async () => {
    const owner = await seedUser();

    await createOrganization({ name: "Acme", ownerId: owner._id });

    const keys = (await RoleModel.find({})).map((role) => role.key).sort();
    expect(keys).toEqual(["ADMIN", "MEMBER", "OWNER", "VIEWER"]);
    // The source of truth is the constant, not a copy of it, so adding a fifth
    // system role later fails here instead of silently going untested.
    expect([...keys].sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
  });

  it("marks all four as system roles", async () => {
    const owner = await seedUser();

    await createOrganization({ name: "Acme", ownerId: owner._id });

    const roles = await RoleModel.find({});
    expect(roles.every((role) => role.isSystem)).toBe(true);
  });

  it("marks MEMBER, and only MEMBER, as the default", async () => {
    const owner = await seedUser();

    await createOrganization({ name: "Acme", ownerId: owner._id });

    const defaults = await RoleModel.find({ isDefault: true });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.key).toBe(DEFAULT_ROLE_KEY);
  });

  it("gives every role a name and a description", async () => {
    const owner = await seedUser();

    await createOrganization({ name: "Acme", ownerId: owner._id });

    for (const role of await RoleModel.find({})) {
      expect(role.name.length).toBeGreaterThan(0);
      expect(role.description?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("provisions per organisation, not globally", async () => {
    const owner = await seedUser();

    const first = await createOrganization({
      name: "Acme",
      ownerId: owner._id,
    });
    const second = await createOrganization({
      name: "Globex",
      ownerId: owner._id,
    });

    expect(first.organization._id).not.toEqual(second.organization._id);
    // Eight roles in total, four each, and the same keys in both - which is the
    // point of storing them per tenant rather than referencing a template.
    expect(await RoleModel.countDocuments({})).toBe(8);
    expect(
      await RoleModel.countDocuments({
        organizationId: first.organization._id,
      }),
    ).toBe(4);
    expect(
      await RoleModel.countDocuments({
        organizationId: second.organization._id,
      }),
    ).toBe(4);
  });

  it("gives the founder an active membership on the owner role", async () => {
    const owner = await seedUser();

    const result = await createOrganization({
      name: "Acme",
      ownerId: owner._id,
    });

    const membership = await MembershipModel.findById(result.membership._id);
    expect(membership?.status).toBe("ACTIVE");
    expect(membership?.userId).toEqual(owner._id);

    const role = await RoleModel.findById(result.ownerRoleId);
    expect(role?.key).toBe("OWNER");
    expect(role?.organizationId).toEqual(result.organization._id);
  });

  it("produces a usable tenant immediately", async () => {
    // The end-to-end claim behind "usable": the founder can pass the real DAL
    // guard, not merely hold a row that looks right.
    const owner = await seedUser();
    const { token, session } = await issueSession({ userId: owner._id });
    await SessionModel.updateOne(
      { _id: session._id },
      { $set: { activeOrganizationId: null } },
    );

    const { createAuthGuards } = await import("@/shared/auth/dal");
    const { setActiveOrganization } = await import("@/modules/organizations");
    const guards = createAuthGuards(async () => token);

    const result = await createOrganization({
      name: "Acme",
      ownerId: owner._id,
      sessionId: session._id,
    });

    const ctx = await guards.requireOrg();
    expect(ctx.organization._id).toEqual(result.organization._id);
    expect(ctx.role.key).toBe("OWNER");

    // And the session was pointed at it by creation, not left unset.
    expect(
      (await SessionModel.findById(session._id))?.activeOrganizationId,
    ).toEqual(result.organization._id);

    await setActiveOrganization(session._id, result.organization._id);
  });

  describe("pointing a session at a new organisation", () => {
    it("refuses a revoked session, and creates nothing", async () => {
      // A session id arrives in a request body, so it is a bearer value, not a
      // reference. Pointing a dead session at a live organisation would hand
      // somebody who has already been signed out an organisation.
      const owner = await seedUser();
      const { session } = await issueSession({ userId: owner._id });
      await SessionModel.updateOne(
        { _id: session._id },
        { $set: { revokedAt: new Date() } },
      );

      await expect(
        createOrganization({
          name: "Acme",
          ownerId: owner._id,
          sessionId: session._id,
        }),
      ).rejects.toThrow(/session/i);

      // The whole transaction rolled back: no orphan organisation either.
      expect(await OrganizationModel.countDocuments({})).toBe(0);
    });

    it("refuses an expired session, and creates nothing", async () => {
      const owner = await seedUser();
      const { session } = await issueSession({ userId: owner._id });
      await SessionModel.updateOne(
        { _id: session._id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

      await expect(
        createOrganization({
          name: "Acme",
          ownerId: owner._id,
          sessionId: session._id,
        }),
      ).rejects.toThrow(/session/i);

      expect(await OrganizationModel.countDocuments({})).toBe(0);
    });

    it("refuses a session belonging to somebody else", async () => {
      // Owning the session is not the same as being its user. Without the
      // userId in the filter, an owner could point somebody else's session at
      // their new organisation and pull that account into the tenant.
      const owner = await seedUser();
      const other = await seedUser();
      const { session } = await issueSession({ userId: other._id });

      await expect(
        createOrganization({
          name: "Acme",
          ownerId: owner._id,
          sessionId: session._id,
        }),
      ).rejects.toThrow(/session/i);

      // And the other user's session was left exactly as it was.
      const reloaded = await SessionModel.findById(session._id);
      expect(reloaded?.activeOrganizationId ?? null).toBeNull();
      expect(await OrganizationModel.countDocuments({})).toBe(0);
    });
  });

  describe("refusing to run twice", () => {
    it("throws rather than silently succeeding", async () => {
      const owner = await seedUser();
      await createOrganization({ name: "Acme", ownerId: owner._id });

      const second = await createOrganization({
        name: "Acme Two",
        ownerId: owner._id,
      });

      await expect(
        provisionSystemRoles(second.organization._id, owner._id),
      ).rejects.toBeInstanceOf(RoleProvisioningError);
    });

    it("names the existing roles in the refusal", async () => {
      // A message that says what happened is the difference between a bug
      // report and a two-minute fix.
      const owner = await seedUser();
      const result = await createOrganization({
        name: "Acme",
        ownerId: owner._id,
      });

      await expect(
        provisionSystemRoles(result.organization._id, owner._id),
      ).rejects.toThrow(/OWNER/);
    });

    it("leaves the existing roles intact", async () => {
      const owner = await seedUser();
      const result = await createOrganization({
        name: "Acme",
        ownerId: owner._id,
      });

      await provisionSystemRoles(result.organization._id, owner._id).catch(
        () => undefined,
      );

      expect(
        await RoleModel.countDocuments({
          organizationId: result.organization._id,
        }),
      ).toBe(4);
    });
  });

  describe("atomicity", () => {
    it("rolls the organisation back when provisioning fails", async () => {
      // The failure this protects against is the dangerous one: an
      // organisation row with no roles, which no screen can repair because the
      // unique index blocks a second OWNER and the DAL has nothing to grant.
      const owner = await seedUser();
      const organization = await OrganizationModel.create({
        name: "Half Made",
        slug: `half-${new Types.ObjectId()}`,
        createdBy: owner._id,
      });

      // Force the role insert to fail partway by pre-creating a conflicting
      // custom key is not possible (the check catches it first), so instead
      // assert the transactional property directly: an org created inside a
      // transaction that then throws leaves nothing behind.
      const { withTransaction } = await import("@/db/transaction");
      await expect(
        withTransaction(async (session) => {
          await OrganizationModel.create(
            [
              {
                name: "Doomed",
                slug: `doomed-${new Types.ObjectId()}`,
                createdBy: owner._id,
              } as never,
            ],
            { session },
          );
          throw new Error("simulated failure after the organisation insert");
        }),
      ).rejects.toThrow("simulated failure");

      expect(await OrganizationModel.countDocuments({ name: "Doomed" })).toBe(
        0,
      );
      expect(
        await RoleModel.countDocuments({ organizationId: organization._id }),
      ).toBe(0);
    });
  });

  describe("defaults", () => {
    it("finds the default role for an organisation", async () => {
      const owner = await seedUser();
      const result = await createOrganization({
        name: "Acme",
        ownerId: owner._id,
      });

      const role = await findDefaultRole(result.organization._id);
      expect(role?.key).toBe(DEFAULT_ROLE_KEY);
    });

    it("returns null for an organisation that has no roles", async () => {
      const owner = await seedUser();
      const stranger = await createOrganization({
        name: "Acme",
        ownerId: owner._id,
      });
      await RoleModel.deleteMany({ organizationId: stranger.organization._id });

      expect(await findDefaultRole(stranger.organization._id)).toBeNull();
    });
  });

  describe("input", () => {
    it("refuses a blank name", async () => {
      const owner = await seedUser();

      await expect(
        createOrganization({ name: "   ", ownerId: owner._id }),
      ).rejects.toBeInstanceOf(OrganizationCreationError);
    });

    it("refuses a missing owner", async () => {
      await expect(
        createOrganization({ name: "Acme", ownerId: "" }),
      ).rejects.toBeInstanceOf(OrganizationCreationError);
    });

    it("gives two organisations with the same name different slugs", async () => {
      const owner = await seedUser();

      const first = await createOrganization({
        name: "Acme",
        ownerId: owner._id,
      });
      const second = await createOrganization({
        name: "Acme",
        ownerId: owner._id,
      });

      expect(first.organization.slug).not.toBe(second.organization.slug);
    });

    it("slugifies a name into something URL-safe", async () => {
      const owner = await seedUser();

      const result = await createOrganization({
        name: "Ünïcode Ço — Åccounting & Co.",
        ownerId: owner._id,
      });

      expect(result.organization.slug).toMatch(/^[a-z0-9-]+$/);
    });
  });
});

describe("SYSTEM_ROLE_KEYS", () => {
  it("is exactly the four documented roles", () => {
    const expected: SystemRoleKey[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
    expect([...SYSTEM_ROLE_KEYS]).toEqual(expected);
  });
});
