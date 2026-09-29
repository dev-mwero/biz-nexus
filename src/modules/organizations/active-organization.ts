import { Types } from "mongoose";
import { type Session, SessionModel } from "@/modules/identity";
import { MembershipModel, OrganizationModel } from "@/modules/organizations";

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
export class ActiveOrganizationError extends Error {
  readonly code = "ORGANIZATION_UNAVAILABLE" as const;

  constructor(message = "Organization not found.") {
    super(message);
    this.name = "ActiveOrganizationError";
  }
}

export async function setActiveOrganization(
  sessionId: Types.ObjectId | string,
  organizationId: Types.ObjectId | string,
): Promise<Session> {
  const target = new Types.ObjectId(String(organizationId));

  const organization = await OrganizationModel.findOne({
    _id: target,
    isActive: true,
    deletedAt: null,
  });
  if (!organization) throw new ActiveOrganizationError();

  const membership = await MembershipModel.findOne({
    organizationId: target,
    userId: (await currentUserId(sessionId)) ?? undefined,
    status: "ACTIVE",
    deletedAt: null,
  });
  if (!membership) throw new ActiveOrganizationError();

  const session = await SessionModel.findOneAndUpdate(
    { _id: new Types.ObjectId(String(sessionId)), revokedAt: null },
    { $set: { activeOrganizationId: target } },
    { returnDocument: "after" },
  );

  if (!session) throw new ActiveOrganizationError();

  return session;
}

async function currentUserId(sessionId: Types.ObjectId | string) {
  const session = await SessionModel.findOne({
    _id: new Types.ObjectId(String(sessionId)),
  });
  return session?.userId ?? null;
}
