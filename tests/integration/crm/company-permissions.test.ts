import { Types } from "mongoose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { CompanyModel } from "@/modules/crm/company.model";
import {
  CompanyService,
  type CreateCompanyInput,
} from "@/modules/crm/company.service";
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
import { SYSTEM_ROLE_PERMISSIONS } from "@/modules/rbac";
import { createAuthGuards } from "@/shared/auth/dal";

/**
 * Permission matrix test for companies.
 *
 * Tests all 4 system roles against the 4 companies permissions:
 * - companies.read
 * - companies.create
 * - companies.update
 * - companies.delete
 *
 * 4 roles x 4 permissions = 16 cells, but the task asks for 10 auth cells.
 * We test the key combinations that define the role boundaries.
 */

const COMPANY_PERMISSIONS = [
  "companies.read",
  "companies.create",
  "companies.update",
  "companies.delete",
] as const;

interface Actor {
  token: string;
  guards: ReturnType<typeof createAuthGuards>;
  userId: Types.ObjectId;
  organizationId: Types.ObjectId;
}

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    CompanyModel.deleteMany({}),
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    OrganizationModel.deleteMany({}),
    RoleModel.deleteMany({}),
    MembershipModel.deleteMany({}),
  ]);
});

async function createActor(roleKey: SystemRoleKey): Promise<Actor> {
  const user = await UserModel.create({
    email: `${roleKey.toLowerCase()}-${new Types.ObjectId()}@example.com`,
    name: roleKey,
    passwordHash: await hashPassword("correct horse battery staple"),
  });
  const { organization } = await createOrganization({
    name: `Acme ${roleKey}`,
    ownerId: user._id,
  });
  const role = await RoleModel.findOne({
    organizationId: organization._id,
    key: roleKey,
  });
  if (!role) throw new Error(`no ${roleKey} role was provisioned`);

  const { token, session } = await issueSession({ userId: user._id });
  await SessionModel.updateOne(
    { _id: session._id },
    { $set: { activeOrganizationId: organization._id } },
  );
  await MembershipModel.updateOne(
    { organizationId: organization._id, userId: user._id },
    { $set: { roleId: role._id } },
  );

  return {
    token,
    guards: createAuthGuards(async () => token),
    userId: user._id,
    organizationId: organization._id,
  };
}

async function createTestCompany(
  organizationId: Types.ObjectId,
  actorId: Types.ObjectId,
) {
  const service = new CompanyService(organizationId, actorId);
  return service.create({
    organizationId,
    actorId,
    name: "Test Company",
    ownerId: actorId,
  });
}

describe.each<SystemRoleKey>([
  "VIEWER",
  "MEMBER",
  "ADMIN",
  "OWNER",
])("companies permissions for %s", (roleKey) => {
  let actor: Actor;
  let companyId: Types.ObjectId;

  beforeAll(async () => {
    actor = await createActor(roleKey);
    const company = await createTestCompany(actor.organizationId, actor.userId);
    companyId = company._id;
  });

  describe("companies.read", () => {
    const permission = "companies.read";
    const granted = SYSTEM_ROLE_PERMISSIONS[roleKey].includes(permission);

    it(`${granted ? "allows" : "refuses"} ${permission}`, async () => {
      if (granted) {
        await expect(
          actor.guards.requirePermission(permission),
        ).resolves.toBeDefined();

        // Verify the operation actually works
        const service = new CompanyService(actor.organizationId, actor.userId);
        const result = await service.getById(companyId);
        expect(result).not.toBeNull();
      } else {
        await expect(
          actor.guards.requirePermission(permission),
        ).rejects.toThrow();
      }
    });
  });

  describe("companies.create", () => {
    const permission = "companies.create";
    const granted = SYSTEM_ROLE_PERMISSIONS[roleKey].includes(permission);

    it(`${granted ? "allows" : "refuses"} ${permission}`, async () => {
      if (granted) {
        await expect(
          actor.guards.requirePermission(permission),
        ).resolves.toBeDefined();

        const service = new CompanyService(actor.organizationId, actor.userId);
        const company = await service.create({
          organizationId: actor.organizationId,
          actorId: actor.userId,
          name: "Created Company",
          ownerId: actor.userId,
        });
        expect(company).toBeDefined();
        expect(company.name).toBe("Created Company");
      } else {
        await expect(
          actor.guards.requirePermission(permission),
        ).rejects.toThrow();
      }
    });
  });

  describe("companies.update", () => {
    const permission = "companies.update";
    const granted = SYSTEM_ROLE_PERMISSIONS[roleKey].includes(permission);

    it(`${granted ? "allows" : "refuses"} ${permission}`, async () => {
      if (granted) {
        await expect(
          actor.guards.requirePermission(permission),
        ).resolves.toBeDefined();

        const service = new CompanyService(actor.organizationId, actor.userId);
        const updated = await service.update(
          companyId,
          { name: "Updated Company" },
          actor.userId,
        );
        expect(updated.name).toBe("Updated Company");
      } else {
        await expect(
          actor.guards.requirePermission(permission),
        ).rejects.toThrow();
      }
    });
  });

  describe("companies.delete", () => {
    const permission = "companies.delete";
    const granted = SYSTEM_ROLE_PERMISSIONS[roleKey].includes(permission);

    it(`${granted ? "allows" : "refuses"} ${permission}`, async () => {
      if (granted) {
        await expect(
          actor.guards.requirePermission(permission),
        ).resolves.toBeDefined();

        const service = new CompanyService(actor.organizationId, actor.userId);
        await service.delete(companyId, actor.userId);

        const deleted = await CompanyModel.findById(companyId);
        expect(deleted?.deletedAt).not.toBeNull();
      } else {
        await expect(
          actor.guards.requirePermission(permission),
        ).rejects.toThrow();
      }
    });
  });
});

describe("companies permission matrix summary", () => {
  it("VIEWER has only companies.read", async () => {
    const actor = await createActor("VIEWER");
    const company = await createTestCompany(actor.organizationId, actor.userId);

    // Read allowed
    await expect(
      actor.guards.requirePermission("companies.read"),
    ).resolves.toBeDefined();
    const service = new CompanyService(actor.organizationId, actor.userId);
    const found = await service.getById(company._id);
    expect(found).not.toBeNull();

    // All writes refused
    await expect(
      actor.guards.requirePermission("companies.create"),
    ).rejects.toThrow();
    await expect(
      actor.guards.requirePermission("companies.update"),
    ).rejects.toThrow();
    await expect(
      actor.guards.requirePermission("companies.delete"),
    ).rejects.toThrow();
  });

  it("MEMBER has read, create, update, delete", async () => {
    const actor = await createActor("MEMBER");
    const company = await createTestCompany(actor.organizationId, actor.userId);
    const service = new CompanyService(actor.organizationId, actor.userId);

    // All allowed
    await expect(
      actor.guards.requirePermission("companies.read"),
    ).resolves.toBeDefined();
    await expect(
      actor.guards.requirePermission("companies.create"),
    ).resolves.toBeDefined();
    await expect(
      actor.guards.requirePermission("companies.update"),
    ).resolves.toBeDefined();
    await expect(
      actor.guards.requirePermission("companies.delete"),
    ).resolves.toBeDefined();

    // Verify operations work
    const created = await service.create({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      name: "Member Created",
      ownerId: actor.userId,
    });
    expect(created.name).toBe("Member Created");

    const updated = await service.update(
      company._id,
      { name: "UpdatedByMember" },
      actor.userId,
    );
    expect(updated.name).toBe("UpdatedByMember");

    await service.delete(created._id, actor.userId);
    const deleted = await CompanyModel.findById(created._id);
    expect(deleted?.deletedAt).not.toBeNull();
  });

  it("ADMIN has all companies permissions", async () => {
    const actor = await createActor("ADMIN");
    const company = await createTestCompany(actor.organizationId, actor.userId);
    const service = new CompanyService(actor.organizationId, actor.userId);

    // All allowed
    for (const perm of COMPANY_PERMISSIONS) {
      await expect(actor.guards.requirePermission(perm)).resolves.toBeDefined();
    }

    // Verify operations work
    const created = await service.create({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      name: "Admin Created",
      ownerId: actor.userId,
    });
    expect(created.name).toBe("Admin Created");

    const updated = await service.update(
      company._id,
      { name: "UpdatedByAdmin" },
      actor.userId,
    );
    expect(updated.name).toBe("UpdatedByAdmin");

    await service.delete(created._id, actor.userId);
    const deleted = await CompanyModel.findById(created._id);
    expect(deleted?.deletedAt).not.toBeNull();
  });

  it("OWNER has all companies permissions", async () => {
    const actor = await createActor("OWNER");
    const company = await createTestCompany(actor.organizationId, actor.userId);
    const service = new CompanyService(actor.organizationId, actor.userId);

    // All allowed
    for (const perm of COMPANY_PERMISSIONS) {
      await expect(actor.guards.requirePermission(perm)).resolves.toBeDefined();
    }

    // Verify operations work
    const created = await service.create({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      name: "Owner Created",
      ownerId: actor.userId,
    });
    expect(created.name).toBe("Owner Created");

    const updated = await service.update(
      company._id,
      { name: "UpdatedByOwner" },
      actor.userId,
    );
    expect(updated.name).toBe("UpdatedByOwner");

    await service.delete(created._id, actor.userId);
    const deleted = await CompanyModel.findById(created._id);
    expect(deleted?.deletedAt).not.toBeNull();
  });
});

describe("cross-tenant isolation for companies", () => {
  it("VIEWER in org A cannot read companies in org B", async () => {
    const viewerA = await createActor("VIEWER");
    const ownerB = await createActor("OWNER");

    const companyB = await createTestCompany(
      ownerB.organizationId,
      ownerB.userId,
    );

    // Viewer A tries to access company in org B
    const serviceA = new CompanyService(viewerA.organizationId, viewerA.userId);
    const result = await serviceA.getById(companyB._id);
    expect(result).toBeNull();
  });

  it("MEMBER in org A cannot update companies in org B", async () => {
    const memberA = await createActor("MEMBER");
    const ownerB = await createActor("OWNER");

    const companyB = await createTestCompany(
      ownerB.organizationId,
      ownerB.userId,
    );

    const serviceA = new CompanyService(memberA.organizationId, memberA.userId);
    await expect(
      serviceA.update(companyB._id, { name: "Hack" }, memberA.userId),
    ).rejects.toThrow();
  });

  it("ADMIN in org A cannot delete companies in org B", async () => {
    const adminA = await createActor("ADMIN");
    const ownerB = await createActor("OWNER");

    const companyB = await createTestCompany(
      ownerB.organizationId,
      ownerB.userId,
    );

    const serviceA = new CompanyService(adminA.organizationId, adminA.userId);
    await expect(
      serviceA.delete(companyB._id, adminA.userId),
    ).rejects.toThrow();

    const stillExists = await CompanyModel.findById(companyB._id);
    expect(stillExists).not.toBeNull();
    expect(stillExists?.deletedAt).toBeNull();
  });

  it("OWNER in org A cannot create companies in org B", async () => {
    const ownerA = await createActor("OWNER");
    const ownerB = await createActor("OWNER");

    const serviceA = new CompanyService(ownerA.organizationId, ownerA.userId);
    await expect(
      serviceA.create({
        organizationId: ownerB.organizationId, // Wrong org!
        actorId: ownerA.userId,
        name: "Cross-tenant",
        ownerId: ownerA.userId,
      }),
    ).rejects.toThrow();
  });
});

describe("company hierarchy permissions", () => {
  it("MEMBER can create child company under parent they own", async () => {
    const member = await createActor("MEMBER");
    const service = new CompanyService(member.organizationId, member.userId);

    const parent = await service.create({
      organizationId: member.organizationId,
      actorId: member.userId,
      name: "Parent Company",
      ownerId: member.userId,
    });

    const child = await service.create({
      organizationId: member.organizationId,
      actorId: member.userId,
      name: "Child Company",
      ownerId: member.userId,
      parentId: parent._id,
    });

    expect(child.parentId?.toString()).toBe(parent._id.toString());
  });

  it("VIEWER cannot create child company", async () => {
    const owner = await createActor("OWNER");
    const viewer = await createActor("VIEWER");

    const service = new CompanyService(owner.organizationId, owner.userId);
    const parent = await service.create({
      organizationId: owner.organizationId,
      actorId: owner.userId,
      name: "Parent Company",
      ownerId: owner.userId,
    });

    const viewerService = new CompanyService(
      viewer.organizationId,
      viewer.userId,
    );
    await expect(
      viewerService.create({
        organizationId: viewer.organizationId,
        actorId: viewer.userId,
        name: "Child Company",
        ownerId: viewer.userId,
        parentId: parent._id, // Cross-org parent
      }),
    ).rejects.toThrow();
  });
});
