import { revokeSessionToken } from "@/modules/identity";
import { withApi } from "@/shared/api/with-api";
import {
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
 */
export const POST = withApi(async (request: Request): Promise<Response> => {
  const token = sessionTokenFrom(request);
  if (token) await revokeSessionToken(token);

  return Response.json(
    { data: { signedOut: true } },
    { headers: { "Set-Cookie": unsetSessionCookie() } },
  );
});
