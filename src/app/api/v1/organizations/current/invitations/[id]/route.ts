import { isObjectIdOrHexString } from "mongoose";
import { revokeInvitation } from "@/modules/organizations";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";

/**
 * DELETE /api/v1/organizations/current/invitations/:id
 *
 * Revoke an open invitation. The row is kept, with `revokedAt` set, so the
 * address it went to stays occupied by the partial unique index until the TTL
 * sweeps it — see the index note in `invitation.model.ts`.
 */
export const DELETE = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("invitations.revoke");

  // From the pathname rather than a route context object, matching the other
  // `[id]` routes. The organisation is not taken from here and there is no
  // segment to take it from: `revokeInvitation` filters on the caller's own
  // organisation, so an id from another tenant matches nothing.
  const path = new URL(request.url).pathname;
  const invitationId = decodeURIComponent(path.split("/").pop() ?? "");

  if (!isObjectIdOrHexString(invitationId)) {
    // `revokeInvitation` constructs an ObjectId from this, and a malformed one
    // makes that constructor throw a `BSONError` — which the wrapper maps to a
    // 500. The caller did nothing wrong beyond holding a bad URL, and a 500 on
    // `/invitations/typo` is an alert somebody has to be paged for. Checked
    // here rather than in the service because this is the edge that produced
    // the string; the service has no way to know its input came from a path
    // segment. `isObjectIdOrHexString`, not `ObjectId.isValid` — the latter
    // accepts any twelve-character string, so `not-an-object-id` would pass it.
    throw new AppError("BAD_REQUEST", {
      message: "That invitation id is not valid.",
    });
  }

  const revoked = await revokeInvitation(
    ctx.organization._id,
    invitationId,
    ctx.user._id,
  );

  if (!revoked) {
    // One answer for "no such invitation", "not yours", and "already accepted".
    // `revokeInvitation` reports one boolean for all three, and separating them
    // would either need a second query or a guess — and either way the
    // distinction is an oracle: it answers whether an id exists in this tenant,
    // which is the one thing an id from another tenant should not be able to
    // ask. `RECORD_NOT_FOUND` is also the status docs/API.md commits to for a
    // record the caller cannot see.
    throw AppError.notFound();
  }

  return ok({ revoked: true });
});
