import { issueEmailVerificationToken } from "@/modules/identity";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { requestMeta } from "@/shared/auth/session-http";

/**
 * POST /api/v1/auth/resend-verification
 *
 * Authenticated, so the address is known and no enumeration defence is needed -
 * the session already identifies whose address it is.
 *
 * Always answers the same way whatever state the account is in. A user who is
 * already verified asking again is not an error worth surfacing, and telling
 * them so would leak verification state to a session that has been borrowed.
 *
 * Rate limiting is task 1.31. Until then this is an unthrottled way to have the
 * system mail somebody repeatedly, which is why the limit is called out here and
 * not left to be discovered.
 */
export const POST = withApi(async (request: Request): Promise<Response> => {
  const user = await guardsFor(request).requireUser();
  const { ip } = requestMeta(request);

  const { token } = await issueEmailVerificationToken(user._id, ip);
  void token;

  return Response.json({
    data: {
      sent: true,
      message: "If your address needs verifying, we have sent a link.",
    },
  });
});
