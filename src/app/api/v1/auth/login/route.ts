import {
  issueSession,
  loginBody,
  loginWithPassword,
  parseBody,
  toPublicUser,
} from "@/modules/identity";
import { withApi } from "@/shared/api/with-api";
import { requestMeta, setSessionCookie } from "@/shared/auth/session-http";

/**
 * POST /api/v1/auth/login
 *
 * Every failure - unknown address, wrong password, locked out, suspended - is a
 * 401 `UNAUTHENTICATED` with one message. The service is what enforces that; see
 * `loginWithPassword`. The route's part is not adding a branch that undoes it.
 *
 * No `next` parameter is read here. A redirect target from the query string is a
 * way to bounce someone to another origin after they authenticate, so it is
 * validated against a same-origin path by `safeNextPath` when the client library
 * is built, not echoed from the request.
 */
export const POST = withApi(async (request: Request): Promise<Response> => {
  const body = await parseBody(request, loginBody);
  const meta = requestMeta(request);

  const { user } = await loginWithPassword(body.email, body.password);
  const { token } = await issueSession({ userId: user._id, ...meta });

  return Response.json(
    { data: { user: toPublicUser(user) } },
    { headers: { "Set-Cookie": setSessionCookie(token) } },
  );
});
