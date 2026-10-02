import { AUTH_EVENT_ACTIONS, recordAuthEvent } from "@/modules/audit";
import { revokeAllSessionsForUser } from "@/modules/identity";
import { type ApiContext, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { requestMeta, unsetSessionCookie } from "@/shared/auth/session-http";

/**
 * POST /api/v1/auth/logout-all
 *
 * Requires a session, unlike `/logout`: there is no meaningful way to ask "sign
 * me out everywhere" anonymously, and answering it without one would let a
 * caller with a stale token learn whether it was still good.
 *
 * Used after a password change and when somebody thinks a device is compromised.
 *
 * `auth.logout_all` is written here and nowhere else. The password-reset path
 * also revokes every session, and it is a different event with a different
 * meaning: "everywhere" is something an authenticated person asked for, and a
 * reset revokes sessions as a consequence of changing the credential. Writing
 * this event from the revocation helper would make the two indistinguishable,
 * which is exactly the distinction an investigator needs.
 */
export const POST = withApi(
  async (request: Request, context: ApiContext): Promise<Response> => {
    const user = await guardsFor(request).requireUser();
    const revoked = await revokeAllSessionsForUser(user._id);

    await recordAuthEvent({
      action: AUTH_EVENT_ACTIONS.LOGOUT_ALL,
      outcome: "success",
      userId: user._id,
      email: user.email,
      ...requestMeta(request),
      requestId: context.requestId,
    });

    // Clears this device's cookie too, or the browser keeps presenting a token
    // that is already revoked and every request 401s.
    return Response.json(
      { data: { signedOutEverywhere: true, revokedSessions: revoked } },
      { headers: { "Set-Cookie": unsetSessionCookie() } },
    );
  },
);
