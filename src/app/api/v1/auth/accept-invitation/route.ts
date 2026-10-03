import { z } from "zod";
import {
  acceptInvitation,
  setActiveOrganization,
} from "@/modules/organizations";
import { parseBody } from "@/shared/api/parse-body";
import { type ApiContext, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

const acceptInvitationBody = z.strictObject({
  token: z.string().trim().min(1),
});

/**
 * POST /api/v1/auth/accept-invitation
 *
 * Redeem an invitation token for a membership in the organisation that issued
 * it. Authenticated, but — unlike everything else under `/organizations/current`
 * — deliberately not organisation-scoped: the caller may have no active
 * organisation at all, which is the usual reason they were sent the link. The
 * organisation comes from the token, which the service resolves to an
 * organisation the caller is about to be an ACTIVE member of.
 *
 * The session is moved to the organisation just joined. A member who accepts
 * while pointed somewhere else would otherwise be looking at the wrong tenant
 * for every request that follows, and the response says where the session ended
 * up so the client does not have to guess. `setActiveOrganization` verifies an
 * ACTIVE membership first, and the membership this call just wrote is the one
 * it will find.
 *
 * Every failure here is one of three answers — the token is bad, it is spent, or
 * the account cannot hold a membership — and none of them distinguishes which for
 * an invalid token. The service is where that is enforced; this route adds
 * nothing that could narrow it, and specifically does not report which account
 * the invitation was addressed to.
 */
export const POST = withApi(async (request: Request, _context: ApiContext) => {
  const guards = guardsFor(request);

  // Two guard calls, not one. `requireOrg` cannot be used — it refuses a caller
  // with no active organisation, which is the common case here — and the
  // session row is needed separately for the switch below, because the
  // session id is what that takes. The cost is one extra hashed-token lookup
  // on one endpoint, which is cheaper than reaching past the guards.
  const session = await guards.getSession();
  const user = await guards.requireUser();

  const body = await parseBody(request, acceptInvitationBody);

  const { membership, organization } = await acceptInvitation(
    body.token,
    user._id,
  );

  if (session) {
    await setActiveOrganization(session._id, organization._id.toString());
  }

  return ok({
    membership,
    organization: {
      id: organization._id.toString(),
      name: organization.name,
    },
    activeOrganizationId: organization._id.toString(),
  });
});
