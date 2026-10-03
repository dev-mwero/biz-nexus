import { Types } from "mongoose";
import { withTransaction } from "@/db/transaction";
import { UserModel } from "@/modules/identity";
import { generateToken, hashToken } from "@/modules/identity/password";
import {
  INVITATION_TTL_DAYS,
  type Invitation,
  InvitationModel,
  type Membership,
  MembershipModel,
  type Organization,
  OrganizationModel,
  RoleModel,
} from "@/modules/organizations";
import { DEFAULT_ROLE_KEY } from "@/modules/rbac/role.service";
import { AppError } from "@/shared/errors/app-error";

/**
 * Inviting somebody, and them accepting.
 *
 * The token is the security boundary, so the shape of it matters more than
 * anything else here. 32 random bytes, stored as a SHA-256 digest, raw value
 * returned exactly once and never persisted. That is the same treatment the
 * password-reset token in 1.14 gets, deliberately: a digest means a leaked
 * database backup does not yield a working invitation link, and 32 bytes means
 * the token cannot be guessed or brute-forced within any TTL worth having.
 *
 * The raw token is returned to the caller so a mailer can send it. Nothing in
 * this module writes it to a log, a session, or an event payload.
 */

export class InvitationError extends AppError {
  constructor(
    code:
      | "INVITATION_INVALID"
      | "INVITATION_EXPIRED"
      | "INVITATION_USED"
      | "INVITATION_REVOKED"
      | "ROLE_NOT_IN_ORGANIZATION"
      | "MEMBERSHIP_EXISTS"
      | "EMAIL_REQUIRED",
    message: string,
  ) {
    super(code, { message });
    this.name = "InvitationError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Confirm a role belongs to the organisation about to reference it, and that it
 * is one this organisation may actually hand out.
 *
 * MongoDB has no foreign keys across collections, so an Invitation or
 * Membership can point at a Role in a different tenant and the database will
 * accept it happily. The consequence is not a crash: the membership would grant
 * the permissions of a role this organisation does not own, which is precisely
 * the cross-tenant leak the whole design is built to prevent. Asserted on every
 * write that names a role.
 *
 * `OWNER` is refused for the same reason `changeMemberRole` refuses it, and the
 * reasoning is the same: granting a second owner is an ownership transfer, which
 * has its own permission (`organization.transferOwnership`) and its own
 * confirmation. Without this clause an invitation is a back door around that
 * permission — an ADMIN holds `invitations.create` and is denied
 * `organization.transferOwnership` by design, so the cheapest escalation in the
 * product was "invite a colleague, give them the OWNER role, accept the link
 * yourself from a second account". `inviteMember` refuses to re-invite an
 * existing member, which closes the self-promotion variant and leaves only the
 * two-account one, which is enough.
 */
async function assertRoleInOrganization(
  organizationId: Types.ObjectId,
  roleId: Types.ObjectId,
): Promise<void> {
  const role = await RoleModel.findOne({
    _id: roleId,
    organizationId,
    deletedAt: null,
  });

  if (!role) {
    throw new InvitationError(
      "ROLE_NOT_IN_ORGANIZATION",
      // Deliberately not "belongs to another organisation". The caller sent a
      // role id that is not usable here; confirming where it *is* would answer
      // the only question somebody holding a foreign id is asking.
      "That role is not available for this organization.",
    );
  }

  if (role.key === "OWNER") {
    throw new InvitationError(
      "ROLE_NOT_IN_ORGANIZATION",
      "Ownership is transferred, not assigned. Use the transfer operation.",
    );
  }
}

export interface InviteMemberInput {
  organizationId: Types.ObjectId | string;
  email: string;
  roleId?: Types.ObjectId | string;
  invitedBy: Types.ObjectId | string;
  /** Injected in tests; production leaves it to the clock. */
  now?: Date;
}

export interface InviteMemberResult {
  /** Raw token. Returned once, for the invitation email. Never stored. */
  token: string;
  invitation: Invitation;
  /** True when this replaced an open invitation for the same address. */
  replaced: boolean;
}

/**
 * Invite somebody, or resend to an address that already has an open invitation.
 *
 * Resending replaces the row rather than updating it, and that is forced by the
 * `{organizationId, email}` partial-unique index: it is partial on
 * `acceptedAt: null`, so a revoked or superseded invitation still occupies the
 * slot until the seven-day TTL sweeps it. Updating in place would trip the
 * index the moment the token changed. Deleting and re-inserting inside one
 * transaction keeps the invariant "at most one open invitation per address" true
 * at every point, rather than only after the write.
 */
export async function inviteMember(
  input: InviteMemberInput,
): Promise<InviteMemberResult> {
  const email = input.email?.trim().toLowerCase();
  if (!email) {
    throw new InvitationError(
      "EMAIL_REQUIRED",
      "An invitation needs an email.",
    );
  }

  const organizationId = new Types.ObjectId(String(input.organizationId));
  const invitedBy = new Types.ObjectId(String(input.invitedBy));

  const roleId = input.roleId
    ? new Types.ObjectId(String(input.roleId))
    : await defaultRoleId(organizationId);

  await assertRoleInOrganization(organizationId, roleId);

  // Inviting by address: refuse if somebody with this email is already in the
  // tenant. Sending a second invitation to an existing member produces a link
  // that, on acceptance, silently rewrites their role - so somebody could be
  // promoted to Owner by forwarding themselves an invitation. Checked by
  // address, because the inviter only has an address to go on.
  //
  // Soft-deleted rows are deliberately ignored here. A removed member holding
  // the {organizationId, userId} index slot is the *normal* state after
  // somebody leaves, and refusing to re-invite them would make a leaver
  // permanently uninvitable to their own organisation. Acceptance restores the
  // row rather than creating a second one.
  const existingUser = await UserModel.findOne({ email }).select("_id");
  if (existingUser) {
    const existingMembership = await MembershipModel.findOne({
      organizationId,
      userId: existingUser._id,
      deletedAt: null,
    });
    if (existingMembership) {
      throw new InvitationError(
        "MEMBERSHIP_EXISTS",
        "That person is already a member of this organisation.",
      );
    }
  }

  const now = input.now ?? new Date();
  const token = generateToken();

  return withTransaction(async (session) => {
    const open = await InvitationModel.findOne(
      { organizationId, email, acceptedAt: null },
      undefined,
      { session },
    );

    if (open) {
      // The superseded token must stop working, which means the row it points
      // at has to go. Leaving it would be a second live link into the tenant.
      await InvitationModel.deleteOne({ _id: open._id }, { session });
    }

    const [invitation] = await InvitationModel.create(
      [
        {
          organizationId,
          email,
          roleId,
          tokenHash: hashToken(token),
          invitedBy,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS),
          acceptedAt: null,
          revokedAt: null,
          createdBy: invitedBy,
          updatedBy: invitedBy,
        } as never,
      ],
      { session },
    );

    if (!invitation) {
      throw new InvitationError(
        "INVITATION_INVALID",
        "The invitation could not be created.",
      );
    }

    return { token, invitation, replaced: Boolean(open) };
  });
}

async function defaultRoleId(
  organizationId: Types.ObjectId,
): Promise<Types.ObjectId> {
  const role = await RoleModel.findOne({
    organizationId,
    key: DEFAULT_ROLE_KEY,
    deletedAt: null,
  });
  if (!role) {
    throw new InvitationError(
      "ROLE_NOT_IN_ORGANIZATION",
      "This organisation has no default role to grant.",
    );
  }
  return role._id;
}

export interface AcceptInvitationResult {
  membership: Membership;
  organization: Organization;
}

/**
 * Accept an invitation.
 *
 * Single-use is enforced by one conditional update rather than a read followed
 * by a write. `acceptedAt: null` in the filter means exactly one concurrent
 * caller can match the row, so a link that was forwarded to somebody else, or
 * opened twice, works once. Read-then-write would leave a window in which two
 * redemptions both see an unaccepted invitation.
 *
 * Expiry and revocation are in the same filter, so a token that expired an
 * instant before this call is refused by the database rather than by a check
 * that could race the write.
 */
export async function acceptInvitation(
  token: string,
  userId: Types.ObjectId | string,
  now = new Date(),
): Promise<AcceptInvitationResult> {
  const tokenHash = hashToken(token);
  const user = new Types.ObjectId(String(userId));

  const invitation = await InvitationModel.findOne({
    tokenHash,
    deletedAt: null,
  });
  if (!invitation) {
    throw new InvitationError(
      "INVITATION_INVALID",
      "This invitation link is not valid.",
    );
  }

  if (invitation.revokedAt !== null) {
    throw new InvitationError(
      "INVITATION_REVOKED",
      "This invitation has been revoked.",
    );
  }

  if (invitation.expiresAt.getTime() <= now.getTime()) {
    throw new InvitationError(
      "INVITATION_EXPIRED",
      "This invitation has expired.",
    );
  }

  // Re-checked here as well as at invite time, because the role can have been
  // reassigned or soft-deleted in the days between. An invitation is a stored
  // promise, and a promise made about a role that no longer exists should not
  // be honoured. The same call refuses OWNER, so an invitation row that reached
  // the database by some other route — an older deploy, a hand-written row, a
  // future caller that forgets — is stopped here as well as at the door.
  await assertRoleInOrganization(invitation.organizationId, invitation.roleId);

  return withTransaction(async (session) => {
    const accepted = await InvitationModel.findOneAndUpdate(
      {
        _id: invitation._id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { $gt: now },
      },
      { $set: { acceptedAt: now } },
      { returnDocument: "after", session },
    );

    if (!accepted) {
      // Lost the race, or the invitation was revoked or expired between the
      // read above and this write. All three are the same answer to the caller.
      throw new InvitationError(
        "INVITATION_INVALID",
        "This invitation link is not valid.",
      );
    }

    const organization = await OrganizationModel.findOne(
      { _id: accepted.organizationId, deletedAt: null },
      undefined,
      { session },
    );
    if (!organization) {
      throw new InvitationError(
        "INVITATION_INVALID",
        "This invitation link is not valid.",
      );
    }

    // The accepting account has to be one that can hold a membership. Two ways
    // it might not be: it does not exist, or it is suspended.
    //
    // The missing-user case was a real hole - nothing checked, so any id
    // produced a membership pointing at an account that was never created, and
    // every later read of that membership had to cope with a user that was not
    // there. The suspended case is the same check for a different reason: a
    // suspended account cannot sign in (see `authenticateWithPassword`), so
    // letting it accept an invitation would hand it an ACTIVE membership and
    // route around the suspension it was suspended for.
    //
    // One check and one answer for both, because the difference between "no
    // such user" and "that user is suspended" is an oracle over user ids, and
    // this function's contract is that it never becomes one. The reason is kept
    // in `internal`, which is never serialised, so a log can still tell the two
    // apart.
    //
    // Inside the transaction, and after the invitation checks above, so a caller
    // holding a bad token learns only that it is bad - never whether the account
    // behind it is in a usable state.
    const acceptingUser = await UserModel.findOne({ _id: user }, undefined, {
      session,
    });

    if (!acceptingUser) {
      // Constructed rather than `AppError.notFound(reason)`: the second
      // argument there is a *message*, and RECORD_NOT_FOUND is exposed, so that
      // would put "no user 65f0…" in the response. `internal` is never
      // serialised, which is where the reason belongs.
      throw new AppError("RECORD_NOT_FOUND", {
        internal: `acceptInvitation: no user ${user.toString()}`,
      });
    }

    if (acceptingUser.status === "SUSPENDED") {
      // Same answer as above, deliberately. Distinguishing the two would be an
      // oracle over user ids.
      throw new AppError("RECORD_NOT_FOUND", {
        internal: `acceptInvitation: user ${user.toString()} is suspended`,
      });
    }

    // A previous membership may exist as a soft-deleted row, because the
    // `{organizationId, userId}` unique index is not partial and never forgets.
    // Restoring it is the only way somebody removed and re-invited can return.
    const membership = await MembershipModel.findOneAndUpdate(
      { organizationId: accepted.organizationId, userId },
      {
        $set: {
          roleId: accepted.roleId,
          status: "ACTIVE",
          deletedAt: null,
          joinedAt: now,
          lastActiveAt: null,
          updatedBy: user,
        },
        $setOnInsert: {
          organizationId: accepted.organizationId,
          userId,
          invitedBy: accepted.invitedBy,
          invitedAt: accepted.createdAt,
          createdBy: accepted.invitedBy,
        },
      },
      { upsert: true, returnDocument: "after", session },
    );

    if (!membership) {
      throw new InvitationError(
        "INVITATION_INVALID",
        "This invitation link is not valid.",
      );
    }

    return { membership, organization };
  });
}

export async function revokeInvitation(
  organizationId: Types.ObjectId | string,
  invitationId: Types.ObjectId | string,
  actorId: Types.ObjectId | string,
): Promise<boolean> {
  const result = await InvitationModel.updateOne(
    {
      _id: new Types.ObjectId(String(invitationId)),
      organizationId: new Types.ObjectId(String(organizationId)),
      acceptedAt: null,
    },
    {
      $set: {
        revokedAt: new Date(),
        updatedBy: new Types.ObjectId(String(actorId)),
      },
    },
  );

  return result.modifiedCount === 1;
}

export async function listInvitations(
  organizationId: Types.ObjectId | string,
  options: { includeExpired?: boolean } = {},
): Promise<Invitation[]> {
  const filter: Record<string, unknown> = {
    organizationId: new Types.ObjectId(String(organizationId)),
    acceptedAt: null,
    revokedAt: null,
    deletedAt: null,
  };
  if (!options.includeExpired) {
    filter.expiresAt = { $gt: new Date() };
  }

  return InvitationModel.find(filter).sort({ createdAt: -1 });
}
