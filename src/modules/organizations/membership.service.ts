import { Types } from "mongoose";
import { UserModel } from "@/modules/identity";
import {
  type Membership,
  MembershipModel,
  type MembershipStatus,
  RoleModel,
  type SystemRoleKey,
} from "@/modules/organizations";
import { AppError } from "@/shared/errors/app-error";

/**
 * Changing somebody's standing in an organisation.
 *
 * Every function here takes the organisation explicitly and filters on it, even
 * though the caller has already passed an organisation in the session. That is
 * not redundancy: `requireOrg()` has already established the caller may act
 * *somewhere*, and the id in the request body is the one being acted on. The
 * only way the two are the same is if something checks.
 */

export class MembershipError extends AppError {
  constructor(
    code:
      | "MEMBERSHIP_NOT_FOUND"
      | "ROLE_NOT_IN_ORGANIZATION"
      | "OWNER_REQUIRED",
    message: string,
  ) {
    super(code, { message });
    this.name = "MembershipError";
  }
}

/**
 * Confirm a role belongs to the organisation, and that it is one somebody can
 * actually be given.
 *
 * `OWNER` is refused deliberately. Granting a second owner is an ownership
 * transfer, which is its own operation with its own permission
 * (`organization.transferOwnership`) and its own confirmation, not a side
 * effect of editing a role. Two owners is also how an organisation ends up
 * with nobody who can delete it, because both are busy on holiday.
 *
 * `invitation.service.ts` holds its own copy of this rule, which says the same
 * thing about the same roles. Two copies of a security rule is not a position
 * worth taking lightly, but these two services already each own a role guard
 * that raises their own error type, and unifying them means one service
 * importing the other through the module barrel — a cycle, in a module whose
 * exports are evaluated at import time. If the rule ever moves it moves to a
 * leaf module both of them can import, and the test below is the thing that
 * notices.
 */
async function assertAssignableRole(
  organizationId: Types.ObjectId,
  roleId: Types.ObjectId,
): Promise<void> {
  const role = await RoleModel.findOne({
    _id: roleId,
    organizationId,
    deletedAt: null,
  });

  if (!role) {
    throw new MembershipError(
      "ROLE_NOT_IN_ORGANIZATION",
      // Deliberately not "belongs to another organisation". The caller sent a
      // role id that is not usable here; confirming where it *is* would answer
      // the only question somebody holding a foreign id is asking.
      "That role is not available for this organization.",
    );
  }

  if (role.key === "OWNER") {
    throw new MembershipError(
      "ROLE_NOT_IN_ORGANIZATION",
      "Ownership is transferred, not assigned. Use the transfer operation.",
    );
  }
}

/** Active owners other than the membership being acted on. */
async function ownersRemaining(
  organizationId: Types.ObjectId,
  excludeMembershipId?: Types.ObjectId,
): Promise<number> {
  const ownerRoleIds = (
    await RoleModel.find({ organizationId, key: "OWNER", deletedAt: null })
  ).map((role) => role._id);

  if (ownerRoleIds.length === 0) return 0;

  return MembershipModel.countDocuments({
    organizationId,
    roleId: { $in: ownerRoleIds },
    status: "ACTIVE",
    deletedAt: null,
    ...(excludeMembershipId ? { _id: { $ne: excludeMembershipId } } : {}),
  });
}

export async function changeMemberRole(
  organizationId: Types.ObjectId | string,
  membershipId: Types.ObjectId | string,
  roleId: Types.ObjectId | string,
  actorId: Types.ObjectId | string,
): Promise<Membership> {
  const org = new Types.ObjectId(String(organizationId));
  const membership = new Types.ObjectId(String(membershipId));
  const nextRole = new Types.ObjectId(String(roleId));

  await assertAssignableRole(org, nextRole);

  const updated = await MembershipModel.findOneAndUpdate(
    { _id: membership, organizationId: org, deletedAt: null },
    {
      $set: {
        roleId: nextRole,
        updatedBy: new Types.ObjectId(String(actorId)),
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) {
    throw new MembershipError(
      "MEMBERSHIP_NOT_FOUND",
      "That member is not in this organisation.",
    );
  }

  return updated;
}

export interface SetMembershipStatusResult {
  membership: Membership;
}

/**
 * Suspend or restore a member.
 *
 * Suspension takes effect on the member's next request, because the DAL
 * re-reads the membership on every one — a suspended account is not signed out,
 * it simply stops being able to do anything, and becomes usable again if it is
 * restored without a new login.
 */
export async function setMembershipStatus(
  organizationId: Types.ObjectId | string,
  membershipId: Types.ObjectId | string,
  status: Exclude<MembershipStatus, "INVITED">,
  actorId: Types.ObjectId | string,
): Promise<Membership> {
  const org = new Types.ObjectId(String(organizationId));
  const membership = new Types.ObjectId(String(membershipId));

  if (
    status === "SUSPENDED" &&
    (await ownersRemaining(org, membership)) === 0
  ) {
    throw new MembershipError(
      "OWNER_REQUIRED",
      "This is the only active owner. Transfer ownership before suspending them.",
    );
  }

  const updated = await MembershipModel.findOneAndUpdate(
    { _id: membership, organizationId: org, deletedAt: null },
    {
      $set: {
        status,
        updatedBy: new Types.ObjectId(String(actorId)),
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) {
    throw new MembershipError(
      "MEMBERSHIP_NOT_FOUND",
      "That member is not in this organisation.",
    );
  }

  return updated;
}

/**
 * Remove a member.
 *
 * A soft delete, so the row still satisfies the `{organizationId, userId}`
 * unique index and a re-invitation restores rather than duplicates. Deleting it
 * outright would let a later invitation create a second membership for the same
 * pair, and the two would then disagree about the person's role.
 */
export async function removeMember(
  organizationId: Types.ObjectId | string,
  membershipId: Types.ObjectId | string,
  actorId: Types.ObjectId | string,
): Promise<Membership> {
  const org = new Types.ObjectId(String(organizationId));
  const membership = new Types.ObjectId(String(membershipId));

  if ((await ownersRemaining(org, membership)) === 0) {
    throw new MembershipError(
      "OWNER_REQUIRED",
      "This is the only active owner. Transfer ownership before removing them.",
    );
  }

  const updated = await MembershipModel.findOneAndUpdate(
    { _id: membership, organizationId: org, deletedAt: null },
    {
      $set: {
        status: "SUSPENDED",
        deletedAt: new Date(),
        updatedBy: new Types.ObjectId(String(actorId)),
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) {
    throw new MembershipError(
      "MEMBERSHIP_NOT_FOUND",
      "That member is not in this organisation.",
    );
  }

  return updated;
}

export async function listMembers(
  organizationId: Types.ObjectId | string,
  options: { includeSuspended?: boolean } = {},
): Promise<Membership[]> {
  return MembershipModel.find({
    organizationId: new Types.ObjectId(String(organizationId)),
    deletedAt: null,
    ...(options.includeSuspended ? {} : { status: "ACTIVE" }),
  }).sort({ joinedAt: 1, createdAt: 1 });
}

/**
 * A membership joined to the human it names.
 *
 * The member directory is the one place a client needs the person's name and
 * address next to their role and standing, and those live in two collections.
 * Returning the bare memberships — the ids a caller cannot render — is why the
 * screen that needed this could not be written against `listMembers`.
 */
export interface MemberView {
  /** The membership id, which is what the member routes act on. */
  id: string;
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleKey: SystemRoleKey;
  status: MembershipStatus;
  title: string | null;
  joinedAt: Date | null;
}

/**
 * The directory: memberships resolved against their user and role.
 *
 * Two batched lookups rather than a populate per row, so the cost is constant
 * in the number of members rather than growing with it. A membership whose user
 * has been deleted is dropped rather than rendered as a nameless row: `users`
 * is not a soft-delete collection, so the reference is simply gone, and a row
 * with a role and no person is not a member any more.
 *
 * The role lookup is scoped to the organisation, and a membership pointing at a
 * role that is not in it is dropped for the same reason it is refused on write:
 * cross-collection integrity has no foreign key behind it.
 */
export async function listMembersWithUsers(
  organizationId: Types.ObjectId | string,
  options: { includeSuspended?: boolean } = {},
): Promise<MemberView[]> {
  const org = new Types.ObjectId(String(organizationId));
  const memberships = await listMembers(org, options);
  if (memberships.length === 0) return [];

  const [users, roles] = await Promise.all([
    UserModel.find({ _id: { $in: memberships.map((m) => m.userId) } })
      .select("name email")
      .lean<{ _id: Types.ObjectId; name?: string; email?: string }[]>(),
    RoleModel.find({
      organizationId: org,
      _id: { $in: memberships.map((m) => m.roleId) },
      deletedAt: null,
    })
      .select("key")
      .lean<{ _id: Types.ObjectId; key: SystemRoleKey }[]>(),
  ]);

  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  const roleById = new Map(roles.map((role) => [role._id.toString(), role]));

  return memberships.flatMap((membership) => {
    const user = userById.get(membership.userId.toString());
    const role = roleById.get(membership.roleId.toString());
    if (!user || !role) return [];

    return [
      {
        id: membership._id.toString(),
        userId: membership.userId.toString(),
        name: user.name ?? "",
        email: user.email ?? "",
        roleId: membership.roleId.toString(),
        roleKey: role.key,
        status: membership.status,
        title: membership.title,
        joinedAt: membership.joinedAt,
      },
    ];
  });
}

/**
 * The id of a system role in one organisation, by key.
 *
 * The member routes take a `roleKey` because there is no roles endpoint for a
 * client to learn an id from — the same reason invitations do. This is where
 * that key becomes the id the write needs, scoped to the organisation so a key
 * can only ever resolve to this tenant's role.
 */
export async function roleIdForSystemKey(
  organizationId: Types.ObjectId | string,
  key: SystemRoleKey,
): Promise<Types.ObjectId> {
  const role = await RoleModel.findOne({
    organizationId: new Types.ObjectId(String(organizationId)),
    key,
    deletedAt: null,
  })
    .select("_id")
    .lean<{ _id: Types.ObjectId } | null>();

  if (!role) {
    throw new MembershipError(
      "ROLE_NOT_IN_ORGANIZATION",
      "That role is not available for this organization.",
    );
  }

  return role._id;
}

/**
 * A member removing themselves.
 *
 * Distinct from `removeMember` because the membership is found from the
 * caller's own id rather than named in the request, which is what makes "leave"
 * impossible to point at somebody else. The last-owner refusal is the same one
 * every other removal carries: an organisation with no owner has nobody who can
 * delete it and nobody who can hand it on, and the fix for that is a transfer,
 * not an escape hatch on the way out.
 */
export async function leaveOrganization(
  organizationId: Types.ObjectId | string,
  userId: Types.ObjectId | string,
  actorId: Types.ObjectId | string,
): Promise<Membership> {
  const org = new Types.ObjectId(String(organizationId));

  const membership = await MembershipModel.findOne({
    organizationId: org,
    userId: new Types.ObjectId(String(userId)),
    status: "ACTIVE",
    deletedAt: null,
  });

  if (!membership) {
    throw new MembershipError(
      "MEMBERSHIP_NOT_FOUND",
      "You are not a member of this organisation.",
    );
  }

  if ((await ownersRemaining(org, membership._id)) === 0) {
    throw new MembershipError(
      "OWNER_REQUIRED",
      "You are the only active owner. Transfer ownership before leaving.",
    );
  }

  const updated = await MembershipModel.findOneAndUpdate(
    { _id: membership._id, organizationId: org, deletedAt: null },
    {
      $set: {
        status: "SUSPENDED",
        deletedAt: new Date(),
        updatedBy: new Types.ObjectId(String(actorId)),
      },
    },
    { returnDocument: "after" },
  );

  if (!updated) {
    throw new MembershipError(
      "MEMBERSHIP_NOT_FOUND",
      "You are not a member of this organisation.",
    );
  }

  return updated;
}
