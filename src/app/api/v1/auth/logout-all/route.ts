import { revokeAllSessionsForUser } from "@/modules/identity";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { unsetSessionCookie } from "@/shared/auth/session-http";

/**
 * POST /api/v1/auth/logout-all
 *
 * Requires a session, unlike `/logout`: there is no meaningful way to ask "sign
 * me out everywhere" anonymously, and answering it without one would let a
 * caller with a stale token learn whether it was still good.
 *
 * Used after a password change and when somebody thinks a device is compromised.
 */
export const POST = withApi(async (request: Request): Promise<Response> => {
  const user = await guardsFor(request).requireUser();
  const revoked = await revokeAllSessionsForUser(user._id);

  // Clears this device's cookie too, or the browser keeps presenting a token
  // that is already revoked and every request 401s.
  return Response.json(
    { data: { signedOutEverywhere: true, revokedSessions: revoked } },
    { headers: { "Set-Cookie": unsetSessionCookie() } },
  );
});
