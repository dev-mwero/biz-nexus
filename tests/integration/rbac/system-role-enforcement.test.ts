import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { SessionModel, UserModel } from "@/modules/identity";
import { hashPassword } from "@/modules/identity/password";
import { issueSession } from "@/modules/identity/session.service";
import {
  createOrganization,
  MembershipModel,
  OrganizationModel,
  RoleModel,
  type SystemRoleKey,
} from "@/modules/organizations";
import { SYSTEM_ROLE_PERMISSIONS, systemRoleHas } from "@/modules/rbac";
import { ALL_PERMISSIONS, type Permission } from "@/modules/rbac/permissions";
import { createAuthGuards } from "@/shared/auth/dal";

/**
 * The matrix as the system actually enforces it.
 *
 * The unit test proves the matrix is shaped correctly. This proves the shape
 * reaches a database row and then a live guard, because those are two places
 * the chain can break independently of the table: provisioning could write the
 * wrong array, or the DAL could read something other than what was written.
 * Neither shows up in a table assertion.
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

async function orgWithMember(key: SystemRoleKey) {
  const owner = await UserModel.create({
    email: `owner-${new Types.ObjectId()}@example.com`,
    name: "Owner",
    passwordHash: await hashPassword("correct horse battery staple"),
  });
  const { organization } = await createOrganization({
    name: "Acme",
    ownerId: owner._id,
  });

  const role = await RoleModel.findOne({
    organizationId: organization._id,
    key,
  });
  if (!role) throw new Error(`no ${key} role was provisioned`);

  const { token, session } = await issueSession({ userId: owner._id });
  await SessionModel.updateOne(
    { _id: session._id },
    { $set: { activeOrganizationId: organization._id } },
  );
  // Reassign the membership createOrganization already made, rather than adding
  // a second one: {organizationId, userId} is unique, and the index is right to
  // refuse. Repointing is also closer to what demoting somebody actually does.
  await MembershipModel.updateOne(
    { organizationId: organization._id, userId: owner._id },
    { $set: { roleId: role._id } },
  );

  return { token, organization, roleId: role._id };
}

describe("the matrix, as provisioned", () => {
  it("writes the matrix into every provisioned role", async () => {
    const { organization } = await orgWithMember("OWNER");

    const roles = await RoleModel.find({ organizationId: organization._id });
    expect(roles).toHaveLength(4);

    for (const role of roles) {
      const expected = new Set<Permission>(
        SYSTEM_ROLE_PERMISSIONS[
          role.key as SystemRoleKey
        ] as readonly Permission[],
      );
      expect(
        new Set(role.permissions as Permission[]),
        `${role.key} was provisioned with the wrong permissions`,
      ).toEqual(expected);
    }
  });

  it("gives a fresh organisation a usable owner immediately", async () => {
    // The gap 1.18 left open: a provisioned OWNER held no permissions and could
    // do nothing. This is the test that would have caught it.
    const { token } = await orgWithMember("OWNER");
    const guards = createAuthGuards(async () => token);

    await expect(
      guards.requirePermission("organization.delete"),
    ).resolves.toBeDefined();
    await expect(
      guards.requirePermission("contacts.create"),
    ).resolves.toBeDefined();
  });
});

describe("the matrix, as the guard enforces it", () => {
  it("refuses a viewer any write", async () => {
    const { token } = await orgWithMember("VIEWER");
    const guards = createAuthGuards(async () => token);

    const writes = ALL_PERMISSIONS.filter(
      (permission) => !permission.endsWith(".read"),
    );
    expect(writes.length).toBeGreaterThan(0);

    for (const permission of writes) {
      await expect(
        guards.requirePermission(permission),
        `VIEWER was allowed ${permission}`,
      ).rejects.toThrow();
    }
  });

  it("allows a viewer every read except the audit log", async () => {
    const { token } = await orgWithMember("VIEWER");
    const guards = createAuthGuards(async () => token);

    for (const permission of ALL_PERMISSIONS.filter((p) =>
      p.endsWith(".read"),
    )) {
      if (!systemRoleHas("VIEWER", permission)) {
        await expect(
          guards.requirePermission(permission),
          `VIEWER was allowed ${permission}`,
        ).rejects.toThrow();
        continue;
      }
      await expect(
        guards.requirePermission(permission),
        `VIEWER was refused ${permission}`,
      ).resolves.toBeDefined();
    }
  });

  it("refuses a member anything that manages people", async () => {
    const { token } = await orgWithMember("MEMBER");
    const guards = createAuthGuards(async () => token);

    for (const permission of [
      "users.invite",
      "users.update",
      "users.remove",
      "roles.create",
      "roles.update",
      "roles.delete",
      "invitations.create",
      "invitations.revoke",
    ] as const) {
      await expect(
        guards.requirePermission(permission),
        `MEMBER was allowed ${permission}`,
      ).rejects.toThrow();
    }
  });

  it("refuses a member deleting or transferring the organisation", async () => {
    const { token } = await orgWithMember("MEMBER");
    const guards = createAuthGuards(async () => token);

    for (const permission of [
      "organization.delete",
      "organization.transferOwnership",
      "organization.settings",
    ] as const) {
      await expect(guards.requirePermission(permission)).rejects.toThrow();
    }
  });

  it("allows a member the work the role exists for", async () => {
    const { token } = await orgWithMember("MEMBER");
    const guards = createAuthGuards(async () => token);

    for (const permission of [
      "contacts.create",
      "deals.move",
      "leads.convert",
      "tasks.create",
    ] as const) {
      await expect(
        guards.requirePermission(permission),
        `MEMBER was refused ${permission}`,
      ).resolves.toBeDefined();
    }
  });

  it("refuses an admin destroying or transferring the organisation", async () => {
    const { token } = await orgWithMember("ADMIN");
    const guards = createAuthGuards(async () => token);

    for (const permission of [
      "organization.delete",
      "organization.transferOwnership",
      "organization.settings",
    ] as const) {
      await expect(guards.requirePermission(permission)).rejects.toThrow();
    }

    // And the control: an admin really is an admin.
    await expect(
      guards.requirePermission("users.invite"),
    ).resolves.toBeDefined();
  });

  it("holds the same answer however many times it is asked", async () => {
    // Permission is a property of the role, not of the request, so a second
    // call must not differ. Cheap, and it catches a guard that mutates state.
    const { token } = await orgWithMember("VIEWER");
    const guards = createAuthGuards(async () => token);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        guards.requirePermission("contacts.create"),
      ).rejects.toThrow();
      await expect(
        guards.requirePermission("contacts.read"),
      ).resolves.toBeDefined();
    }
  });
});
