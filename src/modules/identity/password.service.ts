import { Types } from "mongoose";
import { withTransaction } from "@/db/transaction";
import {
  burnPasswordTiming,
  generateToken,
  hashPassword,
  hashToken,
  needsRehash,
  verifyPassword,
} from "./password";
import {
  PASSWORD_RESET_TTL_MINUTES,
  PasswordResetTokenModel,
} from "./password-reset-token.model";
import { revokeAllSessionsForUser } from "./session.service";
import { type User, UserModel } from "./user.model";

/**
 * Password reset. See docs/SECURITY.md §3 and §4.
 *
 * The invariant that shapes this file: requesting a reset must not reveal
 * whether an address is registered, and redeeming a token must be single-use
 * even under a race. Both are enforced by the data, not by careful sequencing
 * in the caller.
 */

const MINUTE_MS = 60 * 1000;

/** Consecutive failures before the account is locked. */
export const MAX_FAILED_LOGINS = 5;

/** How long a lockout lasts. */
export const LOCKOUT_MS = 15 * MINUTE_MS;

/** Whether an account is currently locked out, regardless of stored state. */
export function isLockedOut(
  user: Pick<User, "lockedUntil">,
  now = new Date(),
): boolean {
  return (
    user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime()
  );
}

/**
 * Check a password against a stored user and update the failure counter.
 *
 * Returns a discriminated result rather than throwing, because the caller has
 * three genuinely different outcomes to render: wrong password, locked out, and
 * a rehash that should be written back. The rehash is worth mentioning: the
 * stored hash carries its own cost, so when `BCRYPT_COST` is raised the next
 * successful login upgrades the account, and every account gets upgraded as
 * users return rather than in one migration.
 *
 * Every branch that refuses a sign-in spends one bcrypt verification first, so
 * all three take comparable time. Without it, the two early returns below are
 * microseconds and a wrong password is a full cost-12 hash — which is not a
 * leak of the password, it is a leak of *which of the three things happened*.
 * "This account is suspended" and "this account is locked" are answers an
 * enumeration attempt should not get cheaply, and the burn is the only reason
 * the caller cannot recover them from the clock. The early returns stay: a
 * suspended account must not have its password verified, and a locked one must
 * not count a further attempt.
 */
export async function authenticateWithPassword(
  user: User,
  plainPassword: string,
  now = new Date(),
): Promise<
  | { ok: true; user: User }
  | { ok: false; reason: "invalid-credentials" | "locked-out" | "suspended" }
> {
  if (user.status === "SUSPENDED") {
    await burnPasswordTiming(plainPassword);
    return { ok: false, reason: "suspended" };
  }
  if (isLockedOut(user, now)) {
    await burnPasswordTiming(plainPassword);
    return { ok: false, reason: "locked-out" };
  }

  if (!(await verifyPassword(plainPassword, user.passwordHash))) {
    await recordFailedLogin(user._id, now);
    return { ok: false, reason: "invalid-credentials" };
  }

  // A successful sign-in clears the counter and the lockout, and opportunistically
  // upgrades a hash made at a lower cost. Upgrading here rather than in a
  // migration means accounts are re-hashed as their owners return, and the
  // cost can be raised without a coordinated deploy.
  const set: Record<string, unknown> = {
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: now,
  };
  if (needsRehash(user.passwordHash)) {
    set.passwordHash = await hashPassword(plainPassword);
  }

  await UserModel.updateOne({ _id: user._id }, { $set: set });

  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.lastLoginAt = now;

  return { ok: true, user };
}

/**
 * Count a failed sign-in and lock the account once the limit is reached.
 *
 * The counter is incremented in the database rather than in memory: read here,
 * incremented in JavaScript and written back would let two concurrent failures
 * from different addresses overwrite each other, so an attacker guessing one
 * password at a time from two connections would never reach the limit.
 */
async function recordFailedLogin(
  userId: Types.ObjectId,
  now: Date,
): Promise<void> {
  const updated = await UserModel.findOneAndUpdate(
    { _id: userId },
    { $inc: { failedLoginCount: 1 } },
    { returnDocument: "after" },
  ).select("failedLoginCount");

  if ((updated?.failedLoginCount ?? 0) < MAX_FAILED_LOGINS) return;

  // The `lockedUntil: null` guard keeps a lockout from being pushed forward by
  // every further attempt, which would let someone hold an account locked for as
  // long as they kept guessing.
  await UserModel.updateOne(
    { _id: userId, lockedUntil: null },
    { $set: { lockedUntil: new Date(now.getTime() + LOCKOUT_MS) } },
  );
}

/**
 * Issue a password-reset token for a user.
 *
 * The caller must not branch on a null return. A request for an unknown address
 * takes the same path and returns the same shape, so the response cannot be
 * used to enumerate registered users.
 *
 * Issuing supersedes: every outstanding token for this user is marked spent in
 * the same transaction that creates the new one. A user who has asked for three
 * links has already proved the earlier ones obsolete, and leaving them live
 * means a link mailed to an address an attacker controls stays redeemable for
 * the rest of the hour. Marked, not deleted — `usedAt` is the record, and a
 * deleted row cannot be told apart from one that never existed.
 */
export async function createPasswordResetToken(
  userId: Types.ObjectId | string,
  requestIp?: string | null,
  now = new Date(),
): Promise<{ token: string }> {
  const user = new Types.ObjectId(String(userId));
  const token = generateToken();
  const tokenHash = hashToken(token);

  await withTransaction(async (session) => {
    await PasswordResetTokenModel.updateMany(
      { userId: user, usedAt: null },
      { $set: { usedAt: now } },
      { session },
    );

    await PasswordResetTokenModel.create(
      [
        {
          userId: user,
          tokenHash,
          expiresAt: new Date(
            now.getTime() + PASSWORD_RESET_TTL_MINUTES * MINUTE_MS,
          ),
          usedAt: null,
          requestIp: requestIp ?? null,
        },
      ],
      { session },
    );
  });

  return { token };
}

/**
 * Redeem a reset token and set a new password.
 *
 * The token is consumed in a single conditional update, so two concurrent
 * redemptions of the same link cannot both succeed: the second finds no
 * unconsumed document and is refused. Checking `usedAt` and then writing in two
 * steps would leave a window in which a link that was forwarded works twice.
 *
 * The consume and the password write are one transaction. Consumed without the
 * write is a link that has been invalidated and no password change — the user
 * resets, gets no error, and the next sign-in still uses the old password. That
 * is the worst outcome available, because the request appeared to succeed.
 *
 * The bcrypt hash is computed before the transaction opens: `withTransaction`
 * retries its callback on a write conflict, and a retry re-running a deliberate
 * cost-12 hash holds the transaction open against every other writer for
 * another quarter of a second.
 */
export async function redeemPasswordResetToken(
  token: string,
  newPassword: string,
  now = new Date(),
): Promise<{ ok: boolean; reason?: "invalid" | "expired" | "already-used" }> {
  const tokenHash = hashToken(token);
  const nowDate = new Date(now.getTime());

  const existing = await PasswordResetTokenModel.findOne({ tokenHash });
  if (!existing) return { ok: false, reason: "invalid" };
  if (existing.usedAt !== null) return { ok: false, reason: "already-used" };
  if (existing.expiresAt.getTime() <= nowDate.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const passwordHash = await hashPassword(newPassword);

  // The guard is the whole reason this is safe under concurrency: `usedAt: null`
  // means exactly one caller can match this row.
  const consumed = await withTransaction(async (session) => {
    const claimed = await PasswordResetTokenModel.findOneAndUpdate(
      { _id: existing._id, usedAt: null },
      { $set: { usedAt: nowDate } },
      { returnDocument: "after", session },
    );
    if (!claimed) return null;

    await UserModel.updateOne(
      { _id: claimed.userId },
      { $set: { passwordHash, failedLoginCount: 0, lockedUntil: null } },
      { session },
    );

    return claimed;
  });

  if (!consumed) return { ok: false, reason: "already-used" };

  // Every session is revoked, including any the attacker is holding. A reset is
  // how somebody responds to "somebody has my password", so leaving the old
  // sessions alive would leave the attacker's session exactly as valid as the
  // owner's - the reset would fix the symptom and not the problem.
  //
  // Outside the transaction on purpose. It is a bulk update over one user's
  // sessions, the new password is already written, and the worst case of losing
  // it to a rollback is a session that outlives the reset — which is exactly
  // what the TTL bounds. Inlining it would instead put a multi-document write
  // that can fail on a session already expiring in the path of a completed
  // password change.
  await revokeAllSessionsForUser(consumed.userId);

  return { ok: true };
}
