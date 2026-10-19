import { isObjectIdOrHexString } from "mongoose";
import { z } from "zod";
import {
  changeMemberRole,
  listMembersWithUsers,
  MembershipError,
  removeMember,
  roleIdForSystemKey,
  SYSTEM_ROLE_KEYS,
  setMembershipStatus,
} from "@/modules/organizations";
import { parseBody } from "@/shared/api/parse-body";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";

/**
 * Acting on one membership in the caller's active organisation.
 *
 * The `:id` is a membership id, not a user id, and it is the only thing a
 * client may name. Every write below resolves it through the session's
 * organisation, so an id from another tenant matches nothing and answers the
 * same 404 as an id that does not exist — see `docs/SECURITY.md` on why the
 * two must be indistinguishable.
 */

/** The id from the last path segment, validated as an ObjectId. */
function membershipIdFrom(request: Request): string {
  const path = new URL(request.url).pathname;
  const id = decodeURIComponent(path.split("/").pop() ?? "");

  if (!isObjectIdOrHexString(id)) {
    // A malformed id makes `new Types.ObjectId(...)` throw a `BSONError`, which
    // the wrapper would turn into a 500. Checked here because this is the edge
    // that produced the string. `isObjectIdOrHexString`, not `ObjectId.isValid`:
    // the latter accepts any twelve-character string.
    throw new AppError("BAD_REQUEST", {
      message: "That member id is not valid.",
    });
  }

  return id;
}

/**
 * Run a membership write, with "not found" collapsed to the canonical 404.
 *
 * The service answers `MEMBERSHIP_NOT_FOUND` for a membership that is not in
 * the caller's organisation — which is the same finding as one that does not
 * exist, and must read that way: a distinct code here would tell a caller
 * holding another tenant's id that the id is real but elsewhere. The route is
 * where the wire contract is decided, so the collapse happens here and the
 * service keeps its vocabulary for the callers that legitimately distinguish
 * the two (an invitation flow knows whether it is looking at a member).
 */
async function canonicalNotFound<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof MembershipError &&
      error.code === "MEMBERSHIP_NOT_FOUND"
    ) {
      throw AppError.notFound();
    }
    throw error;
  }
}

/**
 * The membership change, as the member screen sends it.
 *
 * A `strictObject` so `{"roleId": ...}` is refused rather than landing as a
 * 200 that changed the role to the default: clients learn a role by key, since
 * there is no roles endpoint. At least one of the two operations is required,
 * and either may appear alone. `OWNER` is in the enum intentionally — the
 * service refuses it with an explanation, and hiding it at the schema would
 * make the ownership-transfer rule invisible to anyone reading the reference.
 */
const updateMemberBody = z
  .strictObject({
    roleKey: z.enum(SYSTEM_ROLE_KEYS).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .refine((body) => body.roleKey !== undefined || body.status !== undefined, {
    message: "Provide a roleKey or a status to change.",
  });

/**
 * PATCH /api/v1/organizations/current/members/:id
 *
 * Permission: `users.update`
 *
 * A role change and a suspension are two operations that happen to share a
 * route. Either may be sent; both is allowed and applied in the order they are
 * written, role then status, because that is the order a member screen does
 * them and doing it the other way round would let a restore resurrect somebody
 * into a role that was about to be taken away.
 */
export const PATCH = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("users.update");

  const membershipId = membershipIdFrom(request);
  const body = await parseBody(request, updateMemberBody);
  const actorId = ctx.user._id;
  const { roleKey, status } = body;

  if (roleKey !== undefined) {
    const roleId = await roleIdForSystemKey(ctx.organization._id, roleKey);
    await canonicalNotFound(() =>
      changeMemberRole(ctx.organization._id, membershipId, roleId, actorId),
    );
  }

  if (status !== undefined) {
    await canonicalNotFound(() =>
      setMembershipStatus(ctx.organization._id, membershipId, status, actorId),
    );
  }

  // Returned from the directory rather than the raw membership, so the response
  // carries the same shape as the list the screen already rendered and a
  // suspended member is still found (the list defaults to active only).
  const members = await listMembersWithUsers(ctx.organization._id, {
    includeSuspended: true,
  });
  const member = members.find((entry) => entry.id === membershipId);

  if (!member) {
    throw AppError.notFound();
  }

  return ok(member);
});

/**
 * DELETE /api/v1/organizations/current/members/:id
 *
 * Permission: `users.remove`
 *
 * A soft delete in the service, so a re-invitation restores the row rather than
 * creating a second membership for the same person. The last-owner refusal maps
 * to 409: the request is well-formed and the state is what makes it impossible.
 */
export const DELETE = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("users.remove");

  const membershipId = membershipIdFrom(request);

  await canonicalNotFound(() =>
    removeMember(ctx.organization._id, membershipId, ctx.user._id),
  );

  return ok({ removed: true });
});
