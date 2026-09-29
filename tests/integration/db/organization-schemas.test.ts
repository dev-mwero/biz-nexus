import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import {
  InvitationModel,
  MembershipModel,
  type MembershipStatus,
  OrganizationModel,
  RoleModel,
  SYSTEM_ROLE_KEYS,
} from "@/modules/organizations";

const DAY = 24 * 60 * 60 * 1000;

const orgId = new Types.ObjectId();
const otherOrgId = new Types.ObjectId();
const userId = new Types.ObjectId();
const roleId = new Types.ObjectId();

/**
 * Whether the schema declares a top-level field.
 *
 * Checks `schema.paths`, not `schema.obj`: fields contributed by a plugin
 * (softDelete, auditFields, slug) are added with `schema.add()` after the
 * definition object is built, so `obj` reports them as absent and the check
 * quietly passes on schemas that do have them.
 */
const definesField = (
  model: { schema: { paths: Record<string, unknown> } },
  field: string,
) => field in model.schema.paths;

function indexMap(indexes: Record<string, unknown>[]) {
  return new Map<
    string,
    {
      expireAfterSeconds?: number;
      unique?: boolean;
      partialFilterExpression?: unknown;
    }
  >(
    indexes.map(
      (index) =>
        [
          Object.keys(index.key as Record<string, unknown>).join(","),
          index,
        ] as const,
    ),
  );
}

beforeAll(async () => {
  await connectToDatabase();
  await Promise.all([
    OrganizationModel.syncIndexes(),
    RoleModel.syncIndexes(),
    MembershipModel.syncIndexes(),
    InvitationModel.syncIndexes(),
  ]);
});

afterEach(async () => {
  await Promise.all([
    OrganizationModel.deleteMany({}),
    RoleModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    InvitationModel.deleteMany({}),
  ]);
});

const validOrg = (overrides: Record<string, unknown> = {}) => ({
  name: "Acme Corporation",
  slug: "acme-corporation",
  ...overrides,
});

const validRole = (overrides: Record<string, unknown> = {}) => ({
  organizationId: orgId,
  key: "ADMIN",
  name: "Administrator",
  permissions: ["contact.read", "contact.write"],
  ...overrides,
});

const validMembership = (overrides: Record<string, unknown> = {}) => ({
  organizationId: orgId,
  userId,
  roleId,
  ...overrides,
});

const validInvitation = (overrides: Record<string, unknown> = {}) => ({
  organizationId: orgId,
  email: "invitee@example.com",
  roleId,
  tokenHash: "c".repeat(64),
  invitedBy: userId,
  expiresAt: new Date(Date.now() + 7 * DAY),
  ...overrides,
});

describe("organizations", () => {
  it("accepts a valid organisation with documented defaults", async () => {
    const org = await OrganizationModel.create(validOrg());

    expect(org.slug).toBe("acme-corporation");
    expect(org.timezone).toBe("UTC");
    expect(org.currency).toBe("USD");
    expect(org.dateFormat).toBe("YYYY-MM-DD");
    expect(org.weekStartsOn).toBe(1);
    expect(org.isActive).toBe(true);
    expect(org.settings).toEqual({});
    expect(org.deletedAt).toBeNull();
  });

  it("normalises the slug and refuses a global duplicate", async () => {
    await OrganizationModel.create(validOrg({ slug: "Acme-Corporation" }));

    // Globally unique, not per-tenant: the slug is the public handle, so two
    // organisations cannot share one even in different accounts.
    await expect(
      OrganizationModel.create(
        validOrg({ name: "Other", slug: "ACME-CORPORATION" }),
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("requires a name between 1 and 120 characters and a slug", async () => {
    await expect(
      OrganizationModel.create(validOrg({ name: "" })),
    ).rejects.toThrow();
    await expect(
      OrganizationModel.create(validOrg({ name: "x".repeat(121) })),
    ).rejects.toThrow();
    const { slug: _s, ...noSlug } = validOrg();
    await expect(OrganizationModel.create(noSlug)).rejects.toThrow();
  });

  it("constrains weekStartsOn to a day of the week", async () => {
    await expect(
      OrganizationModel.create(validOrg({ weekStartsOn: 7 })),
    ).rejects.toThrow();
    await expect(
      OrganizationModel.create(validOrg({ weekStartsOn: -1 })),
    ).rejects.toThrow();
  });

  it("does not carry an organizationId, because it is the organisation", async () => {
    expect(definesField(OrganizationModel, "organizationId")).toBe(false);
    expect(definesField(OrganizationModel, "createdBy")).toBe(true);
    expect(definesField(OrganizationModel, "slug")).toBe(true);
  });

  it("has a unique slug index and a createdAt index", async () => {
    const byKey = indexMap(await OrganizationModel.collection.indexes());

    expect(byKey.get("slug")?.unique).toBe(true);
    expect(byKey.has("createdAt")).toBe(true);
  });
});

describe("roles", () => {
  it("scopes role keys to the organisation rather than globally", async () => {
    // The same key in two organisations is two unrelated roles. This is the
    // whole reason roles are stored per tenant instead of referenced.
    await RoleModel.create(validRole({ organizationId: orgId, key: "ADMIN" }));
    await RoleModel.create(
      validRole({ organizationId: otherOrgId, key: "ADMIN" }),
    );

    expect(await RoleModel.countDocuments({ key: "ADMIN" })).toBe(2);
  });

  it("refuses two roles with the same key in one organisation", async () => {
    await RoleModel.create(validRole({ key: "ADMIN" }));

    await expect(RoleModel.create(validRole({ key: "ADMIN" }))).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it("upper-cases the key on write", async () => {
    // So that { organizationId, key } cannot be defeated by casing. Without
    // this, "admin" and "ADMIN" are two roles that the guard treats as one.
    const role = await RoleModel.create(validRole({ key: "admin" }));

    expect(role.key).toBe("ADMIN");
  });

  it("defaults to a custom role with no permissions", async () => {
    const role = await RoleModel.create(
      validRole({ isSystem: undefined, permissions: undefined }),
    );

    expect(role.isSystem).toBe(false);
    expect(role.isDefault).toBe(false);
    expect(role.permissions).toEqual([]);
  });

  it("accepts the four system role keys provisioned in 1.18", async () => {
    for (const key of SYSTEM_ROLE_KEYS) {
      const role = await RoleModel.create(
        validRole({
          organizationId: new Types.ObjectId(),
          key,
          isSystem: true,
        }),
      );
      expect(role.key).toBe(key);
    }
  });

  it("has the compound unique index the data model calls for", async () => {
    const byKey = indexMap(await RoleModel.collection.indexes());

    expect(byKey.get("organizationId,key")?.unique).toBe(true);
  });
});

describe("memberships", () => {
  it("accepts a valid membership and defaults to INVITED", async () => {
    const membership = await MembershipModel.create(validMembership());

    expect(membership.status).toBe("INVITED");
    expect(membership.invitedBy).toBeNull();
    expect(membership.joinedAt).toBeNull();
    expect(membership.deletedAt).toBeNull();
  });

  it("refuses a second membership for the same user in one organisation", async () => {
    await MembershipModel.create(validMembership());

    await expect(MembershipModel.create(validMembership())).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it("allows the same user to belong to two organisations", async () => {
    await MembershipModel.create(validMembership({ organizationId: orgId }));
    await MembershipModel.create(
      validMembership({ organizationId: otherOrgId }),
    );

    expect(await MembershipModel.countDocuments({ userId })).toBe(2);
  });

  it("rejects a status outside the allowed set", async () => {
    // Raw JSON reaches the model without passing through TypeScript, so the
    // runtime enum has to agree with the union.
    await expect(
      MembershipModel.create(
        validMembership({ status: "DELETED" as MembershipStatus }),
      ),
    ).rejects.toThrow(/status/i);
  });

  it("requires the organisation, the user and the role", async () => {
    const { organizationId: _o, ...noOrg } = validMembership();
    const { userId: _u, ...noUser } = validMembership();
    const { roleId: _r, ...noRole } = validMembership();

    await expect(MembershipModel.create(noOrg)).rejects.toThrow();
    await expect(MembershipModel.create(noUser)).rejects.toThrow();
    await expect(MembershipModel.create(noRole)).rejects.toThrow();
  });

  it("has all three indexes the data model calls for", async () => {
    const byKey = indexMap(await MembershipModel.collection.indexes());

    expect(byKey.get("organizationId,userId")?.unique).toBe(true);
    expect(byKey.has("userId,status")).toBe(true);
    expect(byKey.has("organizationId,status,lastActiveAt")).toBe(true);
  });

  it("leads every index with organizationId or userId, never a bare filter field", async () => {
    // A missing scope should produce a collection scan, per docs/DATABASE.md §1.
    // An index that leads on something else would let an unscoped query run
    // efficiently, which is the failure mode the index strategy exists to avoid.
    for (const [key] of indexMap(await MembershipModel.collection.indexes())) {
      if (key === "_id") continue; // the default primary key index
      if (!key.startsWith("organizationId") && !key.startsWith("userId")) {
        throw new Error(
          `memberships index does not lead on a scope field: ${key}`,
        );
      }
      expect(true).toBe(true);
    }
  });
});

describe("invitations", () => {
  it("accepts a valid invitation, open by default", async () => {
    const invitation = await InvitationModel.create(validInvitation());

    expect(invitation.acceptedAt).toBeNull();
    expect(invitation.revokedAt).toBeNull();
  });

  it("lower-cases the invitee email", async () => {
    const invitation = await InvitationModel.create(
      validInvitation({ email: "Invitee@Example.COM" }),
    );

    expect(invitation.email).toBe("invitee@example.com");
  });

  it("refuses a duplicate token hash", async () => {
    await InvitationModel.create(validInvitation());

    await expect(
      InvitationModel.create(
        validInvitation({
          email: "other@example.com",
          tokenHash: "c".repeat(64),
        }),
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("refuses a second open invitation for the same address in one organisation", async () => {
    await InvitationModel.create(validInvitation());

    await expect(
      InvitationModel.create(validInvitation({ tokenHash: "d".repeat(64) })),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("allows a fresh invitation once the previous one is accepted", async () => {
    // The uniqueness is partial on acceptedAt: null. Without the partial
    // filter, inviting somebody a second time - after they left, months later -
    // would be permanently impossible.
    await InvitationModel.create(validInvitation({ acceptedAt: new Date() }));

    await expect(
      InvitationModel.create(validInvitation({ tokenHash: "e".repeat(64) })),
    ).resolves.toBeTruthy();
  });

  it("allows the same address to be invited to two organisations", async () => {
    await InvitationModel.create(validInvitation({ organizationId: orgId }));

    await expect(
      InvitationModel.create(
        validInvitation({
          organizationId: otherOrgId,
          tokenHash: "f".repeat(64),
        }),
      ),
    ).resolves.toBeTruthy();
  });

  it("has the unique token index, the partial open-invitation index and the TTL", async () => {
    const byKey = indexMap(await InvitationModel.collection.indexes());

    expect(byKey.get("tokenHash")?.unique).toBe(true);

    const openInvite = byKey.get("organizationId,email");
    expect(openInvite?.unique).toBe(true);
    expect(openInvite?.partialFilterExpression).toEqual({ acceptedAt: null });

    expect(byKey.get("expiresAt")?.expireAfterSeconds).toBe(0);
  });
});

describe("tenant-owned schemas", () => {
  it("all carry a required organizationId except the organisation itself", async () => {
    for (const model of [RoleModel, MembershipModel, InvitationModel]) {
      // Read from `paths` rather than `schema.path(name)`: Mongoose 9 types the
      // second `type` parameter of `path()` as required, and the map holds the
      // identical SchemaType.
      const path = model.schema.paths.organizationId as
        | { isRequired?: boolean }
        | undefined;
      expect(path).toBeDefined();
      expect(path?.isRequired).toBe(true);
    }

    expect(definesField(OrganizationModel, "organizationId")).toBe(false);
  });

  it("all soft delete and audit by default", async () => {
    for (const model of [
      OrganizationModel,
      RoleModel,
      MembershipModel,
      InvitationModel,
    ]) {
      expect(definesField(model, "deletedAt")).toBe(true);
      expect(definesField(model, "createdBy")).toBe(true);
      expect(definesField(model, "updatedBy")).toBe(true);
    }
  });
});
