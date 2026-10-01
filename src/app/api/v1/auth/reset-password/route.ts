import { AUTH_EVENT_ACTIONS, recordAuthEvent } from "@/modules/audit";
import {
  parseBody,
  redeemPasswordResetToken,
  resetPasswordBody,
} from "@/modules/identity";
import { type ApiContext, withApi } from "@/shared/api/with-api";
import { requestMeta, unsetSessionCookie } from "@/shared/auth/session-http";
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
export const POST = withApi(
  async (request: Request, context: ApiContext): Promise<Response> => {
    const body = await parseBody(request, resetPasswordBody);
    const meta = requestMeta(request);

    // The plaintext password goes to the service, which hashes it itself. Passing
    // a hash in from here would mean this route had to know the cost factor, and
    // the wrong one would make every subsequent sign-in fail against a hash it
    // cannot reproduce.
    const result = await redeemPasswordResetToken(body.token, body.password);
    if (!result.ok) {
      // No event for a refused redemption. There is no account to attach one to:
      // the token was invented, expired or already spent, and attributing the
      // attempt to whoever the token used to name would put a real account
      // beside a forgery. The address is not recorded either, so the log holds
      // nothing an attacker could replay.
      throw new AppError("TOKEN_NOT_REDEEMABLE", {
        internal: `reset-password: token ${result.reason ?? "unusable"}`,
      });
    }

    await recordAuthEvent({
      action: AUTH_EVENT_ACTIONS.PASSWORD_RESET_COMPLETED,
      outcome: "success",
      userId: result.userId,
      // The request carried a token and a password; no address, and none is
      // resolved here to fill one in.
      email: null,
      ...meta,
      requestId: context.requestId,
    });

    return Response.json(
      { data: { passwordChanged: true } },
      { headers: { "Set-Cookie": unsetSessionCookie() } },
    );
  },
);
