import {
  forgotPasswordBody,
  parseBody,
  startPasswordReset,
} from "@/modules/identity";
import { withApi } from "@/shared/api/with-api";
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
 * it lands in 1.32. No token is returned in the body, for the same reason
 * `/register` does not return its verification token.
 */
export const POST = withApi(async (request: Request): Promise<Response> => {
  const body = await parseBody(request, forgotPasswordBody);
  const { ip } = requestMeta(request);

  const { token } = await startPasswordReset(body.email, ip);
  // Reserved for the mailer. Deliberately not returned and not logged.
  void token;

  return Response.json({
    data: {
      sent: true,
      message: "If that address has an account, we have sent a link.",
    },
  });
});
