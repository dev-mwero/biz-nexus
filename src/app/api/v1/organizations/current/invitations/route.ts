import { listInvitations } from "@/modules/organizations";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

/**
 * GET /api/v1/organizations/current/invitations
 *
 * The open invitations for the caller's active organisation. Expired and revoked
 * rows are left out by default, because the question an administrator opens this
 * endpoint to answer is "who is still waiting", and a list that includes last
 * week's lapsed invitations answers a different question.
 *
 * `?includeExpired=true` widens it to the open invitations that have run out,
 * which is what you want when deciding whether to resend rather than whether to
 * chase somebody. Accepted invitations are never listed, under either setting:
 * they are not pending anything.
 *
 * The `current` segment is the tenant, read from the session. There is no
 * `:organizationId` here and there is no way to ask for another organisation's
 * invitations — see docs/SECURITY.md on why the organisation is not an input.
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("invitations.read");

  const url = new URL(request.url);
  const includeExpired = url.searchParams.get("includeExpired") === "true";

  const invitations = await listInvitations(ctx.organization._id, {
    includeExpired,
  });

  return ok(invitations);
});
