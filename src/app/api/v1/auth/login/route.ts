import { AUTH_EVENT_ACTIONS, recordAuthEvent } from "@/modules/audit";
import {
  issueSession,
  loginBody,
  loginWithPassword,
  parseBody,
  toPublicUser,
  unauthenticated,
} from "@/modules/identity";
import { type ApiContext, withApi } from "@/shared/api/with-api";
import { requestMeta, setSessionCookie } from "@/shared/auth/session-http";

/**
 * POST /api/v1/auth/login
 *
 * Every failure - unknown address, wrong password, locked out, suspended - is a
 * 401 `UNAUTHENTICATED` with one message. The service is what enforces that; see
 * `loginWithPassword`. The route's part is not adding a branch that undoes it -
 * which is why the refusal is re-thrown rather than handled: the two writes
 * below are all that distinguishes this handler from the one it used to be, and
 * neither can reach the response.
 *
 * The refusal carries the facts the response must not: which account was named,
 * and whether this attempt is the one that locked it (ADR-0006). Both are written
 * here rather than inside `loginWithPassword`, because that function is a rule
 * about passwords and an audit concern inside it inverts the layering.
 *
 * No `next` parameter is read here. A redirect target from the query string is a
 * way to bounce someone to another origin after they authenticate, so it is
 * validated against a same-origin path by `safeNextPath` when the client library
 * is built, not echoed from the request.
 */
export const POST = withApi(
  async (request: Request, context: ApiContext): Promise<Response> => {
    const body = await parseBody(request, loginBody);
    const meta = requestMeta(request);

    const outcome = await loginWithPassword(body.email, body.password);

    if (!outcome.ok) {
      // Two rows, and the second one is not a special case of the first. The
      // attempt that trips the lockout is also a wrong password, so both facts
      // are true of it and both are worth keeping: `auth.login_failed` is the
      // attempt, `auth.lockout` is the moment, and collapsing them makes the
      // moment inferable only from the last row of a run - which a drop-policy
      // log cannot distinguish from a dropped row.
      await recordAuthEvent({
        action: AUTH_EVENT_ACTIONS.LOGIN_FAILED,
        outcome: "failure",
        userId: outcome.userId,
        email: body.email,
        ip: meta.ip,
        userAgent: meta.userAgent,
        requestId: context.requestId,
      });
      if (outcome.locked) {
        await recordAuthEvent({
          action: AUTH_EVENT_ACTIONS.LOCKOUT,
          outcome: "failure",
          userId: outcome.userId,
          email: body.email,
          ip: meta.ip,
          userAgent: meta.userAgent,
          requestId: context.requestId,
        });
      }

      throw unauthenticated(outcome.reason);
    }

    const { user } = outcome;
    const { token } = await issueSession({ userId: user._id, ...meta });

    // After `issueSession`, not before. A successful sign-in is the session
    // existing; a row written before it would record a sign-in that never
    // completed for a client holding no cookie.
    await recordAuthEvent({
      action: AUTH_EVENT_ACTIONS.LOGIN,
      outcome: "success",
      userId: user._id,
      email: user.email,
      ip: meta.ip,
      userAgent: meta.userAgent,
      requestId: context.requestId,
    });

    return Response.json(
      { data: { user: toPublicUser(user) } },
      { headers: { "Set-Cookie": setSessionCookie(token) } },
    );
  },
);
