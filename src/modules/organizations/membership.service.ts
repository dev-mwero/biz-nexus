import { Types } from "mongoose";
import {
  type Membership,
  MembershipModel,
  type MembershipStatus,
  RoleModel,
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
