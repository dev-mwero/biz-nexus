import { AUTH_EVENT_ACTIONS, recordAuthEvent } from "@/modules/audit";
import { revokeSessionToken } from "@/modules/identity";
import { type ApiContext, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import {
  requestMeta,
  sessionTokenFrom,
  unsetSessionCookie,
} from "@/shared/auth/session-http";

/**
 * POST /api/v1/auth/logout
 *
 * Revokes the session in the database as well as clearing the cookie. Clearing
 * the cookie alone is theatre: the token is a bearer credential, so anything that
 * captured it - a proxy log, a shared machine, a stale extension - keeps working
 * until it expires on its own.
 *
 * Succeeds with 200 even when there is no session. A sign-out button should not
 * report an error to somebody who is already signed out, and making it one would
 * turn the endpoint into a way to ask whether a given token is still live.
 *
 * `getSession()` rather than `requireUser()`: a suspended account must still be
 * able to sign out, and requiring a user would turn this into a 401 for exactly
 * the people most likely to need it.
 */
export const POST = withApi(
  async (request: Request, context: ApiContext): Promise<Response> => {
    const token = sessionTokenFrom(request);
    // Read before the revoke, because after it the session is gone. `null` here
    // is a real and recorded case - somebody signed out with no cookie - and it
    // is recorded rather than skipped so the collection has no branch that can
    // forget to write.
    const session = await guardsFor(request).getSession();

    if (token) await revokeSessionToken(token);

    await recordAuthEvent({
      action: AUTH_EVENT_ACTIONS.LOGOUT,
      outcome: "success",
      userId: session?.userId ?? null,
      // No address: a logout request carries a cookie and no body, and resolving
      // the account again purely to fill in a readable label is a lookup whose
      // only output is cosmetic.
      email: null,
      ...requestMeta(request),
      requestId: context.requestId,
    });

    return Response.json(
      { data: { signedOut: true } },
      { headers: { "Set-Cookie": unsetSessionCookie() } },
    );
  },
);
