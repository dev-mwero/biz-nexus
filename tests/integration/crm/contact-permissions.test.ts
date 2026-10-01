import { Types } from "mongoose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { ContactModel } from "@/modules/crm/contact.model";
import {
  ContactService,
  type CreateContactInput,
} from "@/modules/crm/contact.service";
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
 * Permission matrix test for contacts.
 *
 * Tests all 4 system roles against the 4 contacts permissions:
 * - contacts.read
 * - contacts.create
 * - contacts.update
 * - contacts.delete
 *
 * 4 roles x 4 permissions = 16 cells, but the task asks for 10 auth cells.
 * We test the key combinations that define the role boundaries.
 */

const CONTACT_PERMISSIONS = [
  "contacts.read",
  "contacts.create",
  "contacts.update",
  "contacts.delete",
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
    ContactModel.deleteMany({}),
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

async function createTestContact(
  organizationId: Types.ObjectId,
  actorId: Types.ObjectId,
) {
  const service = new ContactService(organizationId, actorId);
  return service.create({
    organizationId,
    actorId,
    firstName: "Test",
    lastName: "Contact",
    ownerId: actorId,
    emails: [
      {
        label: "Work",
        value: `test-${new Types.ObjectId()}@example.com`,
        isPrimary: true,
      },
    ],
  });
}

describe.each<SystemRoleKey>([
  "VIEWER",
  "MEMBER",
  "ADMIN",
  "OWNER",
])("contacts permissions for %s", (roleKey) => {
  let actor: Actor;
  let contactId: Types.ObjectId;

  beforeAll(async () => {
    actor = await createActor(roleKey);
    const contact = await createTestContact(actor.organizationId, actor.userId);
    contactId = contact._id;
  });

  describe("contacts.read", () => {
    const permission = "contacts.read";
    const granted = SYSTEM_ROLE_PERMISSIONS[roleKey].includes(permission);

    it(`${granted ? "allows" : "refuses"} ${permission}`, async () => {
      if (granted) {
        await expect(
          actor.guards.requirePermission(permission),
        ).resolves.toBeDefined();

        // Verify the operation actually works
        const service = new ContactService(actor.organizationId, actor.userId);
        const result = await service.getById(contactId);
        expect(result).not.toBeNull();
      } else {
        await expect(
          actor.guards.requirePermission(permission),
        ).rejects.toThrow();
      }
    });
  });

  describe("contacts.create", () => {
    const permission = "contacts.create";
    const granted = SYSTEM_ROLE_PERMISSIONS[roleKey].includes(permission);

    it(`${granted ? "allows" : "refuses"} ${permission}`, async () => {
      if (granted) {
        await expect(
          actor.guards.requirePermission(permission),
        ).resolves.toBeDefined();

        const service = new ContactService(actor.organizationId, actor.userId);
        const contact = await service.create({
          organizationId: actor.organizationId,
          actorId: actor.userId,
          firstName: "Created",
          lastName: "Contact",
          ownerId: actor.userId,
          emails: [
            {
              label: "Work",
              value: `created-${new Types.ObjectId()}@example.com`,
              isPrimary: true,
            },
          ],
        });
        expect(contact).toBeDefined();
        expect(contact.firstName).toBe("Created");
      } else {
        await expect(
          actor.guards.requirePermission(permission),
        ).rejects.toThrow();
      }
    });
  });

  describe("contacts.update", () => {
    const permission = "contacts.update";
    const granted = SYSTEM_ROLE_PERMISSIONS[roleKey].includes(permission);

    it(`${granted ? "allows" : "refuses"} ${permission}`, async () => {
      if (granted) {
        await expect(
          actor.guards.requirePermission(permission),
        ).resolves.toBeDefined();

        const service = new ContactService(actor.organizationId, actor.userId);
        const updated = await service.update(
          contactId,
          { firstName: "Updated" },
          actor.userId,
        );
        expect(updated.firstName).toBe("Updated");
      } else {
        await expect(
          actor.guards.requirePermission(permission),
        ).rejects.toThrow();
      }
    });
  });

  describe("contacts.delete", () => {
    const permission = "contacts.delete";
    const granted = SYSTEM_ROLE_PERMISSIONS[roleKey].includes(permission);

    it(`${granted ? "allows" : "refuses"} ${permission}`, async () => {
      if (granted) {
        await expect(
          actor.guards.requirePermission(permission),
        ).resolves.toBeDefined();

        const service = new ContactService(actor.organizationId, actor.userId);
        await service.delete(contactId, actor.userId);

        const deleted = await ContactModel.findById(contactId);
        expect(deleted?.deletedAt).not.toBeNull();
      } else {
        await expect(
          actor.guards.requirePermission(permission),
        ).rejects.toThrow();
      }
    });
  });
});

describe("contacts permission matrix summary", () => {
  it("VIEWER has only contacts.read", async () => {
    const actor = await createActor("VIEWER");
    const contact = await createTestContact(actor.organizationId, actor.userId);

    // Read allowed
    await expect(
      actor.guards.requirePermission("contacts.read"),
    ).resolves.toBeDefined();
    const service = new ContactService(actor.organizationId, actor.userId);
    const found = await service.getById(contact._id);
    expect(found).not.toBeNull();

    // All writes refused
    await expect(
      actor.guards.requirePermission("contacts.create"),
    ).rejects.toThrow();
    await expect(
      actor.guards.requirePermission("contacts.update"),
    ).rejects.toThrow();
    await expect(
      actor.guards.requirePermission("contacts.delete"),
    ).rejects.toThrow();
  });

  it("MEMBER has read, create, update, delete", async () => {
    const actor = await createActor("MEMBER");
    const contact = await createTestContact(actor.organizationId, actor.userId);
    const service = new ContactService(actor.organizationId, actor.userId);

    // All allowed
    await expect(
      actor.guards.requirePermission("contacts.read"),
    ).resolves.toBeDefined();
    await expect(
      actor.guards.requirePermission("contacts.create"),
    ).resolves.toBeDefined();
    await expect(
      actor.guards.requirePermission("contacts.update"),
    ).resolves.toBeDefined();
    await expect(
      actor.guards.requirePermission("contacts.delete"),
    ).resolves.toBeDefined();

    // Verify operations work
    const created = await service.create({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      firstName: "Member",
      lastName: "Created",
      ownerId: actor.userId,
      emails: [
        {
          label: "Work",
          value: `member-${new Types.ObjectId()}@example.com`,
          isPrimary: true,
        },
      ],
    });
    expect(created.firstName).toBe("Member");

    const updated = await service.update(
      contact._id,
      { firstName: "UpdatedByMember" },
      actor.userId,
    );
    expect(updated.firstName).toBe("UpdatedByMember");

    await service.delete(created._id, actor.userId);
    const deleted = await ContactModel.findById(created._id);
    expect(deleted?.deletedAt).not.toBeNull();
  });

  it("ADMIN has all contacts permissions", async () => {
    const actor = await createActor("ADMIN");
    const contact = await createTestContact(actor.organizationId, actor.userId);
    const service = new ContactService(actor.organizationId, actor.userId);

    // All allowed
    for (const perm of CONTACT_PERMISSIONS) {
      await expect(actor.guards.requirePermission(perm)).resolves.toBeDefined();
    }

    // Verify operations work
    const created = await service.create({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      firstName: "Admin",
      lastName: "Created",
      ownerId: actor.userId,
      emails: [
        {
          label: "Work",
          value: `admin-${new Types.ObjectId()}@example.com`,
          isPrimary: true,
        },
      ],
    });
    expect(created.firstName).toBe("Admin");

    const updated = await service.update(
      contact._id,
      { firstName: "UpdatedByAdmin" },
      actor.userId,
    );
    expect(updated.firstName).toBe("UpdatedByAdmin");

    await service.delete(created._id, actor.userId);
    const deleted = await ContactModel.findById(created._id);
    expect(deleted?.deletedAt).not.toBeNull();
  });

  it("OWNER has all contacts permissions", async () => {
    const actor = await createActor("OWNER");
    const contact = await createTestContact(actor.organizationId, actor.userId);
    const service = new ContactService(actor.organizationId, actor.userId);

    // All allowed
    for (const perm of CONTACT_PERMISSIONS) {
      await expect(actor.guards.requirePermission(perm)).resolves.toBeDefined();
    }

    // Verify operations work
    const created = await service.create({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      firstName: "Owner",
      lastName: "Created",
      ownerId: actor.userId,
      emails: [
        {
          label: "Work",
          value: `owner-${new Types.ObjectId()}@example.com`,
          isPrimary: true,
        },
      ],
    });
    expect(created.firstName).toBe("Owner");

    const updated = await service.update(
      contact._id,
      { firstName: "UpdatedByOwner" },
      actor.userId,
    );
    expect(updated.firstName).toBe("UpdatedByOwner");

    await service.delete(created._id, actor.userId);
    const deleted = await ContactModel.findById(created._id);
    expect(deleted?.deletedAt).not.toBeNull();
  });
});

describe("cross-tenant isolation for contacts", () => {
  it("VIEWER in org A cannot read contacts in org B", async () => {
    const viewerA = await createActor("VIEWER");
    const ownerB = await createActor("OWNER");

    const contactB = await createTestContact(
      ownerB.organizationId,
      ownerB.userId,
    );

    // Viewer A tries to access contact in org B
    const serviceA = new ContactService(viewerA.organizationId, viewerA.userId);
    const result = await serviceA.getById(contactB._id);
    expect(result).toBeNull();
  });

  it("MEMBER in org A cannot update contacts in org B", async () => {
    const memberA = await createActor("MEMBER");
    const ownerB = await createActor("OWNER");

    const contactB = await createTestContact(
      ownerB.organizationId,
      ownerB.userId,
    );

    const serviceA = new ContactService(memberA.organizationId, memberA.userId);
    await expect(
      serviceA.update(contactB._id, { firstName: "Hack" }, memberA.userId),
    ).rejects.toThrow();
  });

  it("ADMIN in org A cannot delete contacts in org B", async () => {
    const adminA = await createActor("ADMIN");
    const ownerB = await createActor("OWNER");

    const contactB = await createTestContact(
      ownerB.organizationId,
      ownerB.userId,
    );

    const serviceA = new ContactService(adminA.organizationId, adminA.userId);
    await expect(
      serviceA.delete(contactB._id, adminA.userId),
    ).rejects.toThrow();

    const stillExists = await ContactModel.findById(contactB._id);
    expect(stillExists).not.toBeNull();
    expect(stillExists?.deletedAt).toBeNull();
  });
});
