import { listMembersWithUsers } from "@/modules/organizations";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

/**
 * GET /api/v1/organizations/current/members
 *
 * Permission: `users.read`
 *
 * The member directory: one row per active membership, with the person's name
 * and address resolved from their user, so the screen can render a row without
 * a second call per member. `?includeSuspended=true` also lists suspended
 * members, which is what an administrator needs when deciding whether to
 * restore somebody rather than who is currently here.
 *
 * Members whose user row has been deleted are omitted — the reference is gone
 * and a row with a role and no person is not a member any more.
 *
 * The organisation is the session's, never an input. There is no
 * `:organizationId` and no query parameter that names another tenant.
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("users.read");

  const includeSuspended =
    new URL(request.url).searchParams.get("includeSuspended") === "true";

  const members = await listMembersWithUsers(ctx.organization._id, {
    includeSuspended,
  });

  return ok(members);
});
