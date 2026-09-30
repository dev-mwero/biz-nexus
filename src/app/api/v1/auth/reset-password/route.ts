import {
  parseBody,
  redeemPasswordResetToken,
  resetPasswordBody,
} from "@/modules/identity";
import { withApi } from "@/shared/api/with-api";
import { unsetSessionCookie } from "@/shared/auth/session-http";
import { AppError } from "@/shared/errors/app-error";

/**
 * POST /api/v1/auth/reset-password
 *
 * Consumes a single-use token, sets the new password, and revokes every session
 * for the account. The revocation is the part that is easy to leave out and the
 * part that matters: without it, whoever prompted the reset keeps a working
 * session, so the person who recovered the account has not locked them out -
 * which is the one thing a reset prompted by somebody else is for.
 *
 * This route clears the cookie as well, so the device that performed the reset
 * does not keep presenting a token that has just been revoked.
 *
 * A token that is expired, already used or invented produces one identical
 * `TOKEN_NOT_REDEEMABLE`. Distinguishing them tells an attacker whether a token
 * was ever real, and a reset link forwarded by email should not be testable that
 * way. The `internal` field is where the real reason goes: the client cannot
 * tell them apart, and the log is the only place the question "was this a replay
 * or a forgery?" is answerable afterwards.
 */
export const POST = withApi(async (request: Request): Promise<Response> => {
  const body = await parseBody(request, resetPasswordBody);

  // The plaintext password goes to the service, which hashes it itself. Passing
  // a hash in from here would mean this route had to know the cost factor, and
  // the wrong one would make every subsequent sign-in fail against a hash it
  // cannot reproduce.
  const result = await redeemPasswordResetToken(body.token, body.password);
  if (!result.ok) {
    throw new AppError("TOKEN_NOT_REDEEMABLE", {
      internal: `reset-password: token ${result.reason ?? "unusable"}`,
    });
  }

  return Response.json(
    { data: { passwordChanged: true } },
    { headers: { "Set-Cookie": unsetSessionCookie() } },
  );
});
