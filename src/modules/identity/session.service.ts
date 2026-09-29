import { Types } from "mongoose";
import { generateToken, hashToken } from "./password";
import { SESSION_TTL_DAYS, type Session, SessionModel } from "./session.model";

/**
 * Session lifecycle. See docs/SECURITY.md §4 and ADR-0002.
 *
 * Opaque tokens in an opaque store, rather than a self-contained JWT: a JWT
 * cannot be revoked before it expires, which would make logout, "sign out
 * everywhere" and suspension all advisory. For a product holding customer
 * contact data, revocability is not a nice-to-have.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = SESSION_TTL_DAYS * DAY_MS;

/**
 * How stale `lastUsedAt` and `expiresAt` are allowed to get before a request
 * refreshes them.
 *
 * Sliding expiry taken literally is a write on every authenticated request,
 * which makes the sessions collection the hottest write in the system for no
 * user-visible gain - the value of a session does not change because somebody
 * clicked twice. One touch per hour keeps "last active" honest and keeps the
 * write rate proportional to active sessions rather than to traffic.
 */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Extend the expiry only once it is less than half gone.
 *
 * Refreshing the expiry on every touch would be sliding, but the clock would
 * then advance in hourly steps and a session could be extended indefinitely by
 * a background poll. Re-arming only when the remaining lifetime has halved
 * means a session used daily still rolls forward indefinitely, while a session
 * nobody touches expires on schedule.
 */
const REFRESH_THRESHOLD_MS = TTL_MS / 2;

export interface IssuedSession {
  /**
   * The raw token. Returned to the client once and never persisted or logged;
   * everything downstream works from `hashToken(token)`.
   */
  token: string;
  session: Session;
}

export interface IssueSessionInput {
  userId: Types.ObjectId | string;
  userAgent?: string | null;
  ip?: string | null;
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + TTL_MS);
}

/**
 * Create a session and return its token.
 *
 * `activeOrganizationId` starts null. A user with no organisation is a normal
 * state, and choosing one is a separate act with its own permission check - not
 * something that happens implicitly at sign-in.
 */
export async function issueSession(
  input: IssueSessionInput,
): Promise<IssuedSession> {
  const token = generateToken();
  const now = new Date();

  const session = await SessionModel.create({
    userId: new Types.ObjectId(String(input.userId)),
    tokenHash: hashToken(token),
    activeOrganizationId: null,
    userAgent: input.userAgent ?? null,
    ip: input.ip ?? null,
    expiresAt: expiryFrom(now),
    lastUsedAt: now,
    revokedAt: null,
  });

  return { token, session };
}

/**
 * Resolve a cookie token to a live session, or null.
 *
 * Returns null for every way a token can fail - unknown, revoked, expired - so
 * the caller cannot distinguish them and cannot accidentally reveal which. A
 * caller that must react differently (an expired-but-known session, to send the
 * user to sign in again) should load the row explicitly rather than widen this.
 */
export async function verifySessionToken(
  token: string,
): Promise<Session | null> {
  if (!token) return null;

  const now = new Date();
  const session = await SessionModel.findOne({ tokenHash: hashToken(token) });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= now.getTime()) return null;

  await touchSession(session, now);
  return session;
}

/** Refresh a session's activity, at most once per SESSION_TOUCH_INTERVAL_MS. */
async function touchSession(session: Session, now: Date): Promise<void> {
  if (now.getTime() - session.lastUsedAt.getTime() < SESSION_TOUCH_INTERVAL_MS)
    return;

  const refreshExpiry =
    session.expiresAt.getTime() - now.getTime() < REFRESH_THRESHOLD_MS;
  const update = refreshExpiry
    ? { lastUsedAt: now, expiresAt: expiryFrom(now) }
    : { lastUsedAt: now };

  await SessionModel.updateOne({ _id: session._id }, update);
  Object.assign(session, update);
}

/**
 * Revoke the session a token belongs to. Returns whether one was revoked.
 *
 * Stamps `revokedAt` rather than deleting the row, so "this session ended at
 * 14:02" stays answerable. The TTL index still removes it later.
 */
export async function revokeSessionToken(token: string): Promise<boolean> {
  if (!token) return false;

  const result = await SessionModel.updateOne(
    { tokenHash: hashToken(token), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

  return result.modifiedCount > 0;
}

/**
 * Revoke every live session for a user, optionally sparing the current one.
 *
 * The `exceptSessionId` is what makes "sign out everywhere else" possible
 * without logging the user out of the tab they are using. Without it, the
 * current session goes too and the user appears to be signed out at random.
 */
export async function revokeAllSessionsForUser(
  userId: Types.ObjectId | string,
  options: { exceptSessionId?: Types.ObjectId | string } = {},
): Promise<number> {
  const filter: Record<string, unknown> = {
    userId: new Types.ObjectId(String(userId)),
    revokedAt: null,
  };

  if (options.exceptSessionId) {
    filter._id = { $ne: new Types.ObjectId(String(options.exceptSessionId)) };
  }

  const result = await SessionModel.updateMany(filter, {
    $set: { revokedAt: new Date() },
  });

  return result.modifiedCount ?? 0;
}

/**
 * Replace a session's token, keeping the session and its active organisation.
 *
 * Called on privilege change - a role edit, a suspension - so a token captured
 * before the change stops working immediately. The old token is revoked rather
 * than overwritten, so a token that was already stolen is visibly dead in the
 * active-sessions list instead of quietly ceasing to work.
 */
export async function rotateSessionToken(
  token: string,
): Promise<IssuedSession | null> {
  const existing = await verifySessionToken(token);
  if (!existing) return null;

  const now = new Date();
  const nextToken = generateToken();

  const session = await SessionModel.findOneAndUpdate(
    { _id: existing._id, revokedAt: null },
    {
      $set: {
        tokenHash: hashToken(nextToken),
        lastUsedAt: now,
        expiresAt: expiryFrom(now),
      },
    },
    { returnDocument: "after" },
  );

  if (!session) return null;
  return { token: nextToken, session };
}

/** Live sessions for a user, most recently used first, for the security screen. */
export async function listActiveSessions(
  userId: Types.ObjectId | string,
): Promise<Session[]> {
  return SessionModel.find({
    userId: new Types.ObjectId(String(userId)),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ lastUsedAt: -1 });
}
