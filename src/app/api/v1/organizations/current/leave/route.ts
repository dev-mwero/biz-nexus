import { leaveOrganization } from "@/modules/organizations";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

/**
 * POST /api/v1/organizations/current/leave
 *
 * Permission: `authenticated` — any active member may leave.
 *
 * This is the one member operation that needs no permission of its own:
 * removing yourself is not an administrative act, and requiring `users.remove`
 * would mean an ordinary member could not leave the organisation they were
 * added to. The membership is found from the caller's own id, never from the
 * request, so there is no id to substitute and no way to make somebody else
 * leave.
 *
 * The last owner is refused with a 409 by the service. An organisation with no
 * owner cannot be deleted or handed on, and the answer to "I want out" when you
 * are the only owner is to transfer ownership first, not to leave a tenant
 * nobody controls.
 *
 * No body. `requireOrg` is the gate: a caller with no active organisation is
 * refused with `ACTIVE_ORGANIZATION_REQUIRED`, which is the correct answer to
 * "leave the organisation I am not in".
 */
export const POST = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requireOrg();

  await leaveOrganization(ctx.organization._id, ctx.user._id, ctx.user._id);

  return ok({ left: true });
});
