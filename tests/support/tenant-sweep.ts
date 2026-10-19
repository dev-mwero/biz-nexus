import { Types } from "mongoose";
import { ActivityModel } from "@/modules/activities";
import { CompanyModel, ContactModel, LeadModel, TagModel } from "@/modules/crm";
import { FieldDefinitionModel } from "@/modules/crm/field-definition.model";
import { SavedViewModel } from "@/modules/crm/saved-view.model";
import { DealModel } from "@/modules/deals";
import { UserModel } from "@/modules/identity";
import { hashToken } from "@/modules/identity/password";
import { SessionModel } from "@/modules/identity/session.model";
import { issueSession } from "@/modules/identity/session.service";
import { NotificationModel } from "@/modules/notifications";
import {
  InvitationModel,
  MembershipModel,
  OrganizationModel,
  RoleModel,
} from "@/modules/organizations";
import { PipelineModel } from "@/modules/pipelines";
import { ALL_PERMISSIONS } from "@/modules/rbac/permissions";
import { TaskModel } from "@/modules/tasks";

/**
 * One session that can act in two organisations, and a record in each.
 *
 * The cross-tenant 404 sweep needs the strongest possible caller: a person who
 * is Owner of *both* organisations, so every membership and permission check
 * the application can make returns true, and the only thing left that can
 * refuse a record from the other tenant is the tenant scope itself. A caller
 * who merely lacks a permission would let a broken implementation pass by
 * answering 403 — which says nothing about isolation.
 *
 * The active organisation is Acme (the "own" tenant). A record seeded in Globex
 * is therefore foreign: reachable only if the handler forgot to scope its
 * lookup by organisation.
 */

export interface TenantWorld {
  userId: Types.ObjectId;
  /** The session's active organisation. A record here is "own". */
  acme: Types.ObjectId;
  /** The other organisation. A record here is "foreign". */
  globex: Types.ObjectId;
  acmeRoleId: Types.ObjectId;
  globexRoleId: Types.ObjectId;
  token: string;
}

export async function seedWorld(): Promise<TenantWorld> {
  const suffix = new Types.ObjectId().toString();
  const user = await UserModel.create({
    email: `sweep-${suffix}@example.com`,
    name: "Owner of both",
    passwordHash: "hash",
  });

  const acme = await OrganizationModel.create({
    name: "Acme",
    slug: `acme-${suffix}`,
    createdBy: user._id,
  });
  const globex = await OrganizationModel.create({
    name: "Globex",
    slug: `globex-${suffix}`,
    createdBy: user._id,
  });

  // Every permission, in both. The permission check cannot be the thing that
  // makes this test pass.
  const permissions = [...ALL_PERMISSIONS];
  const acmeRole = await RoleModel.create({
    organizationId: acme._id,
    key: "OWNER",
    name: "Owner",
    permissions,
    isSystem: true,
  });
  const globexRole = await RoleModel.create({
    organizationId: globex._id,
    key: "OWNER",
    name: "Owner",
    permissions,
    isSystem: true,
  });

  for (const [org, role] of [
    [acme._id, acmeRole._id],
    [globex._id, globexRole._id],
  ] as const) {
    await MembershipModel.create({
      organizationId: org,
      userId: user._id,
      roleId: role,
      status: "ACTIVE",
    });
  }

  const { token, session } = await issueSession({ userId: user._id });
  await SessionModel.updateOne(
    { _id: session._id },
    { $set: { activeOrganizationId: acme._id } },
  );

  return {
    userId: user._id,
    acme: acme._id,
    globex: globex._id,
    acmeRoleId: acmeRole._id,
    globexRoleId: globexRole._id,
    token,
  };
}

/**
 * Each seed creates one record of the shape a route under test reads, and
 * returns its id. Parameters are the owning organisation and the acting user,
 * so the same function seeds the "own" and the "foreign" record and the only
 * difference between the two calls is the tenant.
 */
export interface TenantSeeders {
  company(org: Types.ObjectId, user: Types.ObjectId): Promise<Types.ObjectId>;
  contact(org: Types.ObjectId, user: Types.ObjectId): Promise<Types.ObjectId>;
  lead(org: Types.ObjectId, user: Types.ObjectId): Promise<Types.ObjectId>;
  tag(org: Types.ObjectId, user: Types.ObjectId): Promise<Types.ObjectId>;
  savedView(org: Types.ObjectId, user: Types.ObjectId): Promise<Types.ObjectId>;
  fieldDefinition(
    org: Types.ObjectId,
    user: Types.ObjectId,
  ): Promise<Types.ObjectId>;
  deal(org: Types.ObjectId, user: Types.ObjectId): Promise<Types.ObjectId>;
  pipeline(org: Types.ObjectId, user: Types.ObjectId): Promise<Types.ObjectId>;
  task(org: Types.ObjectId, user: Types.ObjectId): Promise<Types.ObjectId>;
  activity(org: Types.ObjectId, user: Types.ObjectId): Promise<Types.ObjectId>;
  notification(
    org: Types.ObjectId,
    user: Types.ObjectId,
  ): Promise<Types.ObjectId>;
  invitation(
    org: Types.ObjectId,
    user: Types.ObjectId,
    roleId: Types.ObjectId,
  ): Promise<Types.ObjectId>;
  membership(
    org: Types.ObjectId,
    user: Types.ObjectId,
  ): Promise<Types.ObjectId>;
}

export const seed: TenantSeeders = {
  async company(org, user) {
    const doc = await CompanyModel.create({
      organizationId: org,
      name: "Acme Ltd",
      ownerId: user,
      status: "PROSPECT",
      createdBy: user,
      updatedBy: user,
    });
    return doc._id;
  },

  async contact(org, user) {
    const doc = await ContactModel.create({
      organizationId: org,
      firstName: "Jane",
      lastName: "Doe",
      ownerId: user,
      status: "LEAD",
      createdBy: user,
      updatedBy: user,
    });
    return doc._id;
  },

  async lead(org, user) {
    const doc = await LeadModel.create({
      organizationId: org,
      title: "Inbound lead",
      contactSnapshot: {
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
      },
      source: "Website",
      status: "NEW",
      ownerId: user,
      createdBy: user,
      updatedBy: user,
    });
    return doc._id;
  },

  async tag(org, user) {
    const doc = await TagModel.create({
      organizationId: org,
      name: "Priority",
      color: "slate",
      createdBy: user,
      updatedBy: user,
    });
    return doc._id;
  },

  async savedView(org, user) {
    const doc = await SavedViewModel.create({
      organizationId: org,
      userId: user,
      entityType: "CONTACT",
      name: "My view",
      createdBy: user,
      updatedBy: user,
    });
    return doc._id;
  },

  async fieldDefinition(org, user) {
    const doc = await FieldDefinitionModel.create({
      organizationId: org,
      entityType: "CONTACT",
      key: "nickname",
      label: "Nickname",
      type: "TEXT",
      createdBy: user,
      updatedBy: user,
    });
    return doc._id;
  },

  async pipeline(org, user) {
    const doc = await PipelineModel.create({
      organizationId: org,
      name: "Sales",
      isDefault: false,
      order: 0,
      stages: [
        {
          key: "NEW",
          name: "New",
          order: 0,
          probability: 0,
          color: "blue",
          isWon: false,
          isLost: false,
        },
      ],
      createdBy: user,
      updatedBy: user,
    });
    return doc._id;
  },

  async deal(org, user) {
    const pipeline = await PipelineModel.create({
      organizationId: org,
      name: "Sales",
      isDefault: false,
      order: 0,
      stages: [
        {
          key: "NEW",
          name: "New",
          order: 0,
          probability: 0,
          color: "blue",
          isWon: false,
          isLost: false,
        },
      ],
      createdBy: user,
      updatedBy: user,
    });
    const stageId = pipeline.stages[0]?._id;
    if (!stageId) throw new Error("the pipeline fixture has no stage");

    const doc = await DealModel.create({
      organizationId: org,
      name: "Big Deal",
      companyId: null,
      contactId: null,
      pipelineId: pipeline._id,
      stageId,
      ownerId: user,
      value: 0,
      currency: "USD",
      probability: 0,
      status: "OPEN",
      expectedCloseDate: null,
      closedAt: null,
      lostReason: null,
      description: null,
      sortOrder: 0,
      tags: [],
      customFields: {},
      createdBy: user,
      updatedBy: user,
    });
    return doc._id;
  },

  async task(org, user) {
    const doc = await TaskModel.create({
      organizationId: org,
      title: "Do the thing",
      status: "TODO",
      priority: "MEDIUM",
      createdBy: user,
      updatedBy: user,
    });
    return doc._id;
  },

  async activity(org, user) {
    const doc = await ActivityModel.create({
      organizationId: org,
      type: "NOTE",
      title: "A note",
      occurredAt: new Date(),
      actorId: user,
      ownerId: user,
      subjects: [],
      metadata: {},
    });
    return doc._id;
  },

  async notification(org, user) {
    const doc = await NotificationModel.create({
      organizationId: org,
      userId: user,
      type: "SYSTEM",
      channel: "IN_APP",
      title: "Something happened",
      body: "And you should know",
      data: {},
    });
    return doc._id;
  },

  async invitation(org, user, roleId) {
    const doc = await InvitationModel.create({
      organizationId: org,
      email: `invitee-${new Types.ObjectId().toString()}@example.com`,
      roleId,
      tokenHash: hashToken(new Types.ObjectId().toString()),
      invitedBy: user,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      acceptedAt: null,
      revokedAt: null,
    });
    return doc._id;
  },

  /**
   * A membership in `org` for somebody other than the sweep's caller.
   *
   * Deliberately not the caller's own membership: `{ organizationId, userId }`
   * is unique, and the caller already holds one in both organisations. A second
   * user is created so the row is a real, removable member rather than a
   * duplicate the index would refuse.
   */
  async membership(org, _user) {
    const member = await UserModel.create({
      email: `member-${new Types.ObjectId().toString()}@example.com`,
      name: "Directory member",
      passwordHash: "hash",
    });

    const role = await RoleModel.findOne({
      organizationId: org,
      deletedAt: null,
    }).select("_id");
    if (!role) throw new Error("seedWorld must create a role in each org.");

    const doc = await MembershipModel.create({
      organizationId: org,
      userId: member._id,
      roleId: role._id,
      status: "ACTIVE",
    });
    return doc._id;
  },
};
