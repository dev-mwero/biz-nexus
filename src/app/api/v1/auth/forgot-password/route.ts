import { AUTH_EVENT_ACTIONS, recordAuthEvent } from "@/modules/audit";
import {
  forgotPasswordBody,
  parseBody,
  startPasswordReset,
} from "@/modules/identity";
import { type ApiContext, withApi } from "@/shared/api/with-api";
import { requestMeta } from "@/shared/auth/session-http";

/**
 * POST /api/v1/auth/forgot-password
 *
 * Always 200, with the same body, whether or not the address is registered.
 *
 * The message is deliberately the one a caller gets when the account exists
 * ("if that address has an account, we've sent a link"), because the only way to
 * be sure it is not lying is for it to send nothing for an unknown address and
 * something for a known one - and that difference is exactly the oracle. A
 * response that varied by existence would turn this into a membership oracle for
 * the whole user table.
 *
 * The token is produced by the service and discarded here; the mailer that sends
 * it lands in 1.33. No token is returned in the body, for the same reason
 * `/register` does not return its verification token.
 *
 * The audit row is written for known, unknown and suspended alike, with the
 * attempted address on it and `userId` null when there is no account to attribute
 * it to. That is the point of writing it here rather than only on success: the
 * response is deliberately identical in all three cases, so without a row this
 * endpoint has no record of the probing that a burst of requests for addresses
 * that do not exist looks like.
 */
export const POST = withApi(
  async (request: Request, context: ApiContext): Promise<Response> => {
    const body = await parseBody(request, forgotPasswordBody);
    const meta = requestMeta(request);

    const { token, userId } = await startPasswordReset(body.email, meta.ip);
    // Reserved for the mailer. Deliberately not returned and not logged.
    void token;

    await recordAuthEvent({
      action: AUTH_EVENT_ACTIONS.PASSWORD_RESET_REQUESTED,
      // The request succeeded; whether an account was named is `userId`, not the
      // outcome. Recording this as `success` for an unknown address and reading a
      // difference out of the id keeps the enumeration defence in the response
      // where it belongs.
      outcome: "success",
      userId,
      email: body.email,
      ...meta,
      requestId: context.requestId,
    });

    return Response.json({
      data: {
        sent: true,
        message: "If that address has an account, we have sent a link.",
      },
    });
  },
);
