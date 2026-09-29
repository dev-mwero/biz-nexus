import { Types } from "mongoose";
import {
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
 */
export async function authenticateWithPassword(
  user: User,
  plainPassword: string,
  now = new Date(),
): Promise<
  | { ok: true; user: User }
  | { ok: false; reason: "invalid-credentials" | "locked-out" | "suspended" }
> {
  if (user.status === "SUSPENDED") return { ok: false, reason: "suspended" };
  if (isLockedOut(user, now)) return { ok: false, reason: "locked-out" };

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
 */
export async function createPasswordResetToken(
  userId: Types.ObjectId | string,
  requestIp?: string | null,
): Promise<{ token: string }> {
  const token = generateToken();
  const now = new Date();

  await PasswordResetTokenModel.create({
    userId: new Types.ObjectId(String(userId)),
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * MINUTE_MS),
    usedAt: null,
    requestIp: requestIp ?? null,
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
  const consumed = await PasswordResetTokenModel.findOneAndUpdate(
    { _id: existing._id, usedAt: null },
    { $set: { usedAt: nowDate } },
    { returnDocument: "after" },
  );

  if (!consumed) return { ok: false, reason: "already-used" };

  await UserModel.updateOne(
    { _id: consumed.userId },
    { $set: { passwordHash, failedLoginCount: 0, lockedUntil: null } },
  );

  // Every session is revoked, including any the attacker is holding. A reset is
  // how somebody responds to "somebody has my password", so leaving the old
  // sessions alive would leave the attacker's session exactly as valid as the
  // owner's - the reset would fix the symptom and not the problem.
  await revokeAllSessionsForUser(consumed.userId);

  return { ok: true };
}
