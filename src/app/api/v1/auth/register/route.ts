import { AUTH_EVENT_ACTIONS, recordAuthEvent } from "@/modules/audit";
import {
  issueSession,
  parseBody,
  registerBody,
  registerUser,
} from "@/modules/identity";
import { type ApiContext, withApi } from "@/shared/api/with-api";
import { requestMeta, setSessionCookie } from "@/shared/auth/session-http";

/**
 * POST /api/v1/auth/register
 *
 * Creates the account and signs the user in immediately. Per docs/API.md §3 the
 * response carries the user and the session; email verification is not a gate on
 * either, so a user who never receives the mail is not locked out of the account
 * they just made.
 *
 * `EMAIL_ALREADY_REGISTERED` is the one endpoint here that acknowledges a
 * registered address, because a form has to be able to say "this is taken". That
 * is a deliberate trade: it makes registration an enumeration oracle, and it is
 * the reason every other endpoint in this directory answers identically for
 * known and unknown addresses.
 *
 * The verification token is issued but not delivered - the mailer lands in 1.33.
 * It is not returned in the body, because a token in a JSON response is a token
 * in every log, proxy and browser history along the way.
 */
export const POST = withApi(
  async (request: Request, context: ApiContext): Promise<Response> => {
    const body = await parseBody(request, registerBody);
    const meta = requestMeta(request);

    // `user` is already the public projection - `registerUser` returns the
    // allow-list rather than the document, so there is no password hash anywhere
    // near this response.
    const { user, userId, verificationToken } = await registerUser({
      ...body,
      requestIp: meta.ip,
    });
    const { token } = await issueSession({ userId, ...meta });

    // Referenced so the token is unambiguously consumed by the mailer rather than
    // silently dropped; nothing returns it to the client.
    void verificationToken;

    // After the session, for the same reason `/login` writes after `issueSession`:
    // the event is a sign-in, and a client holding no cookie has not signed in.
    //
    // Nothing is written for the refused registrations. `EMAIL_ALREADY_REGISTERED`
    // is already an enumeration oracle and is documented as one; a row keyed on
    // the attempted address would give an operator a second, quieter oracle over
    // the same data, and it would be one nobody chose to build.
    await recordAuthEvent({
      action: AUTH_EVENT_ACTIONS.REGISTER,
      outcome: "success",
      userId,
      email: body.email,
      ...meta,
      requestId: context.requestId,
    });

    return Response.json(
      { data: { user } },
      {
        status: 201,
        headers: {
          "Set-Cookie": setSessionCookie(token),
          // RFC 9110 §10.2.2: a 201 names the resource it created. Without it a
          // client has to know in advance that this endpoint's product lives at
          // `/api/v1/users/{id}`, which is exactly the kind of assumption a future
          // route rename turns into a 404 nobody can explain.
          Location: `/api/v1/users/${user.id}`,
        },
      },
    );
  },
);
