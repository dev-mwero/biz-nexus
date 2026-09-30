import {
  parseBody,
  verifyEmailBody,
  verifyEmailToken,
} from "@/modules/identity";
import { withApi } from "@/shared/api/with-api";
import { AppError } from "@/shared/errors/app-error";

/**
 * POST /api/v1/auth/verify-email
 *
 * Consumes a verification token. An invalid, expired or spent token is one
 * identical 400, for the same reason as the reset link above.
 *
 * A token that verifies an address which was already verified is a success, not
 * an error. The user's intent - "this address is mine" - is satisfied either
 * way, and returning a failure would make a second click on a link they already
 * used look like a problem with the account.
 *
 * Every unusable token is one identical `TOKEN_NOT_REDEEMABLE` - expired, spent,
 * or never issued - for the same reason as the reset link above. `verifyEmailToken`
 * deliberately returns no reason even internally, so this endpoint cannot invent
 * one; `internal` records that a link was presented and refused, which is what
 * makes a burst of them visible.
 */
export const POST = withApi(async (request: Request): Promise<Response> => {
  const body = await parseBody(request, verifyEmailBody);

  const result = await verifyEmailToken(body.token);
  if (!result.ok) {
    throw new AppError("TOKEN_NOT_REDEEMABLE", {
      internal: "verify-email: token expired, already used, or never issued",
    });
  }

  return Response.json({
    data: { verified: true, alreadyVerified: result.alreadyVerified ?? false },
  });
});
