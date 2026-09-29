import { Types } from "mongoose";
import { type Session, SessionModel } from "@/modules/identity";
import { MembershipModel, OrganizationModel } from "@/modules/organizations";
import { AppError } from "@/shared/errors/app-error";

/**
 * Switching the active organisation.
 *
 * The only operation in the system permitted to change a session's active
 * organisation, and the reason the rest of the request lifecycle can treat
 * `session.activeOrganizationId` as trustworthy. There is no request parameter,
 * query string or body field the server will honour as an organisation; this
 * function is the whole of that surface.
 *
 * Membership is checked here, and re-checked on every request by the DAL, so
 * removing somebody from an organisation takes effect immediately rather than
 * whenever their session happens to expire.
 */

/**
 * One error, for every reason the switch can fail.
 *
 * "No such organization" and "you are not a member of it" deliberately produce
 * the same code and the same message. Distinguishing them turns this endpoint
 * into an oracle: an attacker with any account could enumerate which
 * organization ids are real. The membership check below exists to enforce
 * access, not to inform the caller why they were refused.
 *
 * Task 1.22 maps this to 404, so neither answer confirms the organization exists.
 */
export class ActiveOrganizationError extends AppError {
  constructor(message?: string) {
    super("ORGANIZATION_UNAVAILABLE", { message });
    this.name = "ActiveOrganizationError";
  }
}

/**
 * Coerce an untrusted id, or null.
 *
 * `new Types.ObjectId(...)` throws a `BSONError` on a malformed value, and that
 * would escape before any of the uniform refusals below — so a caller could tell
 * "that is not a valid id" apart from "that is not yours", which is precisely
 * the oracle the identical-message rule exists to prevent. It would also reach
 * the client as an unexpected internal error.
 */
function toObjectId(value: Types.ObjectId | string): Types.ObjectId | null {
  if (value instanceof Types.ObjectId) return value;
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

export async function setActiveOrganization(
  sessionId: Types.ObjectId | string,
  organizationId: Types.ObjectId | string,
): Promise<Session> {
  const target = toObjectId(organizationId);
  const targetSessionId = toObjectId(sessionId);
  if (!target || !targetSessionId) throw new ActiveOrganizationError();

  const organization = await OrganizationModel.findOne({
    _id: target,
    isActive: true,
    deletedAt: null,
  });
  if (!organization) throw new ActiveOrganizationError();

  const userId = await currentUserId(targetSessionId);
  if (!userId) throw new ActiveOrganizationError();

  const membership = await MembershipModel.findOne({
    organizationId: target,
    userId,
    status: "ACTIVE",
    deletedAt: null,
  });
  if (!membership) throw new ActiveOrganizationError();

  // ExpiresAt is checked here as well as revokedAt. Without it this returns a
  // dead session as a success, and reports to the caller that an organisation
  // was activated for a session that can no longer be used — a lie the DAL
  // would have to contradict on the very next request.
  const session = await SessionModel.findOneAndUpdate(
    {
      _id: targetSessionId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { activeOrganizationId: target } },
    { returnDocument: "after" },
  );

  if (!session) throw new ActiveOrganizationError();

  return session;
}

async function currentUserId(sessionId: Types.ObjectId) {
  const session = await SessionModel.findOne({
    _id: sessionId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  return session?.userId ?? null;
}
