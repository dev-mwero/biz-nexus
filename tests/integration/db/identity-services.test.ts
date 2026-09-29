import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { type User, UserModel } from "@/modules/identity";
import {
  BCRYPT_COST,
  generateToken,
  hashPassword,
  hashToken,
  needsRehash,
  tokensMatch,
  verifyPassword,
} from "@/modules/identity/password";
import {
  authenticateWithPassword,
  createPasswordResetToken,
  isLockedOut,
  LOCKOUT_MS,
  MAX_FAILED_LOGINS,
  redeemPasswordResetToken,
} from "@/modules/identity/password.service";
import { PasswordResetTokenModel } from "@/modules/identity/password-reset-token.model";
import {
  SESSION_TTL_DAYS,
  SessionModel,
} from "@/modules/identity/session.model";
import {
  issueSession,
  listActiveSessions,
  revokeAllSessionsForUser,
  revokeSessionToken,
  rotateSessionToken,
  SESSION_TOUCH_INTERVAL_MS,
  verifySessionToken,
} from "@/modules/identity/session.service";

const PASSWORD = "correct horse battery staple";
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    PasswordResetTokenModel.deleteMany({}),
  ]);
});

async function makeUser(
  overrides: Record<string, unknown> = {},
): Promise<User> {
  return UserModel.create({
    email: `user-${new Types.ObjectId()}@example.com`,
    name: "Test User",
    passwordHash: await hashPassword(PASSWORD),
    ...overrides,
  });
}

async function loadUser(id: Types.ObjectId): Promise<User> {
  const user = await UserModel.findOne({ _id: id }).select("+passwordHash");
  if (!user) throw new Error("user missing");
  return user;
}

describe("token primitives", () => {
  it("generates 256-bit base64url tokens", () => {
    const token = generateToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes base64url-encoded, unpadded.
    expect(token).toHaveLength(43);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("generates a different token every time", () => {
    const tokens = new Set(Array.from({ length: 500 }, generateToken));

    // 500 samples is not a proof of a good CSPRNG, but it does catch a
    // hard-coded value, a seeded generator, or a clock-derived one.
    expect(tokens.size).toBe(500);
  });

  it("hashes a token to a stable sha256 hex digest", () => {
    const token = generateToken();

    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
  });

  it("compares tokens in constant time without throwing on length mismatch", () => {
    const token = generateToken();

    expect(tokensMatch(token, hashToken(token))).toBe(true);
    expect(tokensMatch(generateToken(), hashToken(token))).toBe(false);
    expect(tokensMatch(token, "not-a-hash")).toBe(false);
    // A stored value that is not a hash at all. The length check comes before
    // the constant-time compare, which would otherwise throw.
    expect(tokensMatch("", "")).toBe(false);
  });
});

describe("password hashing", () => {
  it("hashes at cost 12 and verifies the right password", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([
      hashPassword(PASSWORD),
      hashPassword(PASSWORD),
    ]);

    expect(a).not.toBe(b);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword(PASSWORD, b)).toBe(true);
  });

  it("treats a malformed stored hash as a failed comparison, not a crash", async () => {
    // A 500 here would distinguish "wrong password" from "this account's hash
    // is unreadable", which is information the caller should not get.
    for (const bad of ["", "not-a-hash", "$2b$", "$2b$12$truncated"]) {
      expect(await verifyPassword(PASSWORD, bad)).toBe(false);
    }
  });

  it("flags a hash made at a lower cost for rehashing", async () => {
    const { default: bcrypt } = await import("bcryptjs");
    const cheap = await bcrypt.hash(PASSWORD, 10);

    expect(needsRehash(cheap)).toBe(true);
    expect(needsRehash(await hashPassword(PASSWORD))).toBe(false);
    expect(needsRehash("garbage")).toBe(true);
    expect(BCRYPT_COST).toBe(12);
  });
});

describe("session issue and verify", () => {
  it("issues a session and resolves its token", async () => {
    const user = await makeUser();
    const { token, session } = await issueSession({ userId: user._id });

    expect(session.tokenHash).toBe(hashToken(token));
    expect(session.tokenHash).not.toBe(token);
    expect(session.activeOrganizationId).toBeNull();
    expect(session.revokedAt).toBeNull();

    const found = await verifySessionToken(token);
    expect(found?._id).toEqual(session._id);
  });

  it("stores only the hash, so the database yields no usable token", async () => {
    const user = await makeUser();
    const { token } = await issueSession({ userId: user._id });

    const row = await SessionModel.findOne({ userId: user._id });
    expect(row?.tokenHash).not.toBe(token);
    expect(
      await SessionModel.collection.countDocuments({ tokenHash: token }),
    ).toBe(0);
  });

  it("expires 30 days out", async () => {
    const user = await makeUser();
    const { session } = await issueSession({ userId: user._id });

    const days = (session.expiresAt.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(SESSION_TTL_DAYS - 1);
    expect(days).toBeLessThanOrEqual(SESSION_TTL_DAYS);
  });

  it("rejects an unknown, empty or tampered token", async () => {
    expect(await verifySessionToken(generateToken())).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
    expect(await verifySessionToken("x")).toBeNull();

    const user = await makeUser();
    const { token } = await issueSession({ userId: user._id });
    expect(await verifySessionToken(`${token}x`)).toBeNull();
  });

  it("rejects an expired session even though the row is still present", async () => {
    const user = await makeUser();
    const { token, session } = await issueSession({ userId: user._id });

    await SessionModel.updateOne(
      { _id: session._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    expect(await verifySessionToken(token)).toBeNull();
  });

  it("rejects a revoked session", async () => {
    const user = await makeUser();
    const { token } = await issueSession({ userId: user._id });

    await revokeSessionToken(token);

    expect(await verifySessionToken(token)).toBeNull();
  });
});

describe("sliding expiry", () => {
  it("does not rewrite the row on every request", async () => {
    // The whole point of the throttle. Without it, every authenticated request
    // writes to the sessions collection.
    const user = await makeUser();
    const { token, session } = await issueSession({ userId: user._id });

    const firstUsedAt = session.lastUsedAt.getTime();
    await verifySessionToken(token);
    await verifySessionToken(token);
    await verifySessionToken(token);

    const row = await SessionModel.findOne({ _id: session._id });
    expect(row?.lastUsedAt.getTime()).toBe(firstUsedAt);
  });

  it("refreshes activity once the touch interval has passed", async () => {
    const user = await makeUser();
    const { token, session } = await issueSession({ userId: user._id });

    const stale = new Date(Date.now() - SESSION_TOUCH_INTERVAL_MS - 1000);
    await SessionModel.updateOne(
      { _id: session._id },
      { $set: { lastUsedAt: stale } },
    );

    await verifySessionToken(token);

    const row = await SessionModel.findOne({ _id: session._id });
    expect(row?.lastUsedAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it("extends the expiry only once it is less than half gone", async () => {
    const user = await makeUser();
    const { token, session } = await issueSession({ userId: user._id });

    const stale = new Date(Date.now() - SESSION_TOUCH_INTERVAL_MS - 1000);
    // One day left of thirty: less than half, so the expiry re-arms.
    const nearlyExpired = new Date(Date.now() + 1 * DAY);
    await SessionModel.updateOne(
      { _id: session._id },
      { $set: { lastUsedAt: stale, expiresAt: nearlyExpired } },
    );

    await verifySessionToken(token);

    const row = await SessionModel.findOne({ _id: session._id });
    expect(row?.expiresAt.getTime()).toBeGreaterThan(nearlyExpired.getTime());
  });

  it("does not extend an expiry that is still more than half remaining", async () => {
    // Otherwise a background poll would keep a session alive forever.
    const user = await makeUser();
    const { token, session } = await issueSession({ userId: user._id });

    const stale = new Date(Date.now() - SESSION_TOUCH_INTERVAL_MS - 1000);
    const full = new Date(Date.now() + SESSION_TTL_DAYS * DAY);
    await SessionModel.updateOne(
      { _id: session._id },
      { $set: { lastUsedAt: stale, expiresAt: full } },
    );

    await verifySessionToken(token);

    const row = await SessionModel.findOne({ _id: session._id });
    expect(row?.expiresAt.getTime()).toBe(full.getTime());
  });
});

describe("session revocation", () => {
  it("stamps revokedAt rather than deleting, so revocation is auditable", async () => {
    const user = await makeUser();
    const { token, session } = await issueSession({ userId: user._id });

    expect(await revokeSessionToken(token)).toBe(true);

    const row = await SessionModel.findOne({ _id: session._id });
    expect(row).not.toBeNull();
    expect(row?.revokedAt).toBeInstanceOf(Date);
  });

  it("is idempotent and reports whether it did anything", async () => {
    const user = await makeUser();
    const { token } = await issueSession({ userId: user._id });

    expect(await revokeSessionToken(token)).toBe(true);
    // Revoking twice is a no-op, not an error: logout can be retried.
    expect(await revokeSessionToken(token)).toBe(false);
    expect(await revokeSessionToken("")).toBe(false);
  });

  it("revokes every session for a user", async () => {
    const user = await makeUser();
    const tokens = await Promise.all([
      issueSession({ userId: user._id }),
      issueSession({ userId: user._id }),
      issueSession({ userId: user._id }),
    ]);

    expect(await revokeAllSessionsForUser(user._id)).toBe(3);
    for (const { token } of tokens) {
      expect(await verifySessionToken(token)).toBeNull();
    }
  });

  it("leaves other users' sessions alone", async () => {
    const [mine, theirs] = await Promise.all([makeUser(), makeUser()]);
    const other = await issueSession({ userId: theirs._id });

    await revokeAllSessionsForUser(mine._id);

    expect(await verifySessionToken(other.token)).not.toBeNull();
  });

  it("spares the current session when asked, for sign-out-everywhere-else", async () => {
    const user = await makeUser();
    const current = await issueSession({ userId: user._id });
    const other = await issueSession({ userId: user._id });

    await revokeAllSessionsForUser(user._id, {
      exceptSessionId: current.session._id,
    });

    expect(await verifySessionToken(current.token)).not.toBeNull();
    expect(await verifySessionToken(other.token)).toBeNull();
  });

  it("lists only live sessions, most recently used first", async () => {
    const user = await makeUser();
    const live = await issueSession({ userId: user._id });
    const revoked = await issueSession({ userId: user._id });
    const expired = await issueSession({ userId: user._id });

    await revokeSessionToken(revoked.token);
    await SessionModel.updateOne(
      { _id: expired.session._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const active = await listActiveSessions(user._id);

    expect(active.map((s) => s._id)).toEqual([live.session._id]);
  });
});

describe("session rotation", () => {
  it("issues a new token and kills the old one", async () => {
    const user = await makeUser();
    const { token } = await issueSession({ userId: user._id });

    const rotated = await rotateSessionToken(token);
    if (!rotated) throw new Error("rotation should have produced a session");

    expect(rotated.token).not.toBe(token);
    expect(await verifySessionToken(rotated.token)).not.toBeNull();
    // The old token is dead immediately, which is the point of rotating on a
    // privilege change.
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("keeps the session and its active organisation across a rotation", async () => {
    const user = await makeUser();
    const { token, session } = await issueSession({ userId: user._id });
    const orgId = new Types.ObjectId();
    await SessionModel.updateOne(
      { _id: session._id },
      { $set: { activeOrganizationId: orgId } },
    );

    const rotated = await rotateSessionToken(token);

    expect(rotated?.session.activeOrganizationId).toEqual(orgId);
    expect(rotated?.session._id).toEqual(session._id);
  });

  it("returns null for an unknown or already-revoked token", async () => {
    const user = await makeUser();
    const { token } = await issueSession({ userId: user._id });
    await revokeSessionToken(token);

    expect(await rotateSessionToken(token)).toBeNull();
    expect(await rotateSessionToken(generateToken())).toBeNull();
  });
});

describe("password authentication", () => {
  it("accepts the right password and records the sign-in", async () => {
    const user = await makeUser();
    const result = await authenticateWithPassword(
      await loadUser(user._id),
      PASSWORD,
    );

    expect(result.ok).toBe(true);

    const reloaded = await loadUser(user._id);
    expect(reloaded.lastLoginAt).toBeInstanceOf(Date);
    expect(reloaded.failedLoginCount).toBe(0);
  });

  it("rejects a wrong password and counts the failure", async () => {
    const user = await makeUser();
    const result = await authenticateWithPassword(
      await loadUser(user._id),
      "nope",
    );

    expect(result).toEqual({ ok: false, reason: "invalid-credentials" });
    expect((await loadUser(user._id)).failedLoginCount).toBe(1);
  });

  it("locks the account after the failure limit", async () => {
    const user = await makeUser();

    for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
      await authenticateWithPassword(await loadUser(user._id), "nope");
    }

    const locked = await loadUser(user._id);
    expect(locked.failedLoginCount).toBe(MAX_FAILED_LOGINS);
    expect(isLockedOut(locked)).toBe(true);
  });

  it("refuses even the correct password while locked out", async () => {
    // Otherwise the lockout would only slow down an attacker who kept trying
    // the right password.
    const user = await makeUser();
    for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
      await authenticateWithPassword(await loadUser(user._id), "nope");
    }

    const result = await authenticateWithPassword(
      await loadUser(user._id),
      PASSWORD,
    );

    expect(result).toEqual({ ok: false, reason: "locked-out" });
  });

  it("does not push the lockout forward on further attempts", async () => {
    const user = await makeUser();
    for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
      await authenticateWithPassword(await loadUser(user._id), "nope");
    }
    const first = (await loadUser(user._id)).lockedUntil;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await authenticateWithPassword(await loadUser(user._id), "nope");

    // Otherwise a persistent attacker could keep an account locked for as long
    // as they kept guessing.
    expect((await loadUser(user._id)).lockedUntil).toEqual(first);
  });

  it("counts concurrent failures without losing any", async () => {
    // Read-increment-write in the application would let two failures overwrite
    // each other, so an attacker using two connections would never be locked.
    const user = await makeUser();

    // One loaded user, four concurrent attempts. Every one of them sees the
    // same in-memory state - not locked out, zero failures - which is exactly
    // what makes this a test of the database increment rather than the
    // in-memory one.
    const loaded = await loadUser(user._id);
    await Promise.all(
      Array.from({ length: 4 }, () => authenticateWithPassword(loaded, "nope")),
    );

    expect((await loadUser(user._id)).failedLoginCount).toBe(4);
  });

  it("unlocks and resets the counter on a successful sign-in", async () => {
    const user = await makeUser();
    for (let i = 0; i < 3; i += 1) {
      await authenticateWithPassword(await loadUser(user._id), "nope");
    }

    expect(
      (await authenticateWithPassword(await loadUser(user._id), PASSWORD)).ok,
    ).toBe(true);

    const reloaded = await loadUser(user._id);
    expect(reloaded.failedLoginCount).toBe(0);
    expect(reloaded.lockedUntil).toBeNull();
  });

  it("upgrades a low-cost hash on the next successful sign-in", async () => {
    const { default: bcrypt } = await import("bcryptjs");
    const user = await makeUser({
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    });

    await authenticateWithPassword(await loadUser(user._id), PASSWORD);

    // Raises the cost without a migration: accounts are re-hashed as owners
    // return.
    expect((await loadUser(user._id)).passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("refuses a suspended account even with the right password", async () => {
    const user = await makeUser({ status: "SUSPENDED" });

    const result = await authenticateWithPassword(
      await loadUser(user._id),
      PASSWORD,
    );

    expect(result).toEqual({ ok: false, reason: "suspended" });
  });
});

describe("password reset", () => {
  it("stores only the hash of the emailed token", async () => {
    const user = await makeUser();
    const { token } = await createPasswordResetToken(user._id);

    const row = await PasswordResetTokenModel.findOne({ userId: user._id });
    expect(row?.tokenHash).toBe(hashToken(token));
    expect(row?.tokenHash).not.toBe(token);
    expect(row?.usedAt).toBeNull();
  });

  it("redeems a token and sets the new password", async () => {
    const user = await makeUser();
    const { token } = await createPasswordResetToken(user._id);

    expect(await redeemPasswordResetToken(token, "a new password")).toEqual({
      ok: true,
    });

    const result = await authenticateWithPassword(
      await loadUser(user._id),
      "a new password",
    );
    expect(result.ok).toBe(true);
  });

  it("records use, so the same link cannot be redeemed twice", async () => {
    const user = await makeUser();
    const { token } = await createPasswordResetToken(user._id);

    await redeemPasswordResetToken(token, "first new password");
    const second = await redeemPasswordResetToken(token, "second new password");

    expect(second).toEqual({ ok: false, reason: "already-used" });
    // The second password must not have taken effect.
    expect(
      (
        await authenticateWithPassword(
          await loadUser(user._id),
          "first new password",
        )
      ).ok,
    ).toBe(true);
  });

  it("lets only one of several concurrent redemptions win", async () => {
    // A forwarded link redeemed twice at once. A check-then-write would let
    // both through.
    const user = await makeUser();
    const { token } = await createPasswordResetToken(user._id);

    const results = await Promise.all([
      redeemPasswordResetToken(token, "password one"),
      redeemPasswordResetToken(token, "password two"),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("rejects an unknown token", async () => {
    expect(await redeemPasswordResetToken(generateToken(), "x")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects an expired token", async () => {
    const user = await makeUser();
    const { token } = await createPasswordResetToken(user._id);
    await PasswordResetTokenModel.updateMany(
      {},
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    expect(await redeemPasswordResetToken(token, "x")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("revokes every existing session on reset", async () => {
    // A reset is how somebody responds to "somebody has my password". Leaving
    // old sessions alive fixes the symptom and not the problem.
    const user = await makeUser();
    const session = await issueSession({ userId: user._id });
    const { token } = await createPasswordResetToken(user._id);

    await redeemPasswordResetToken(token, "a new password");

    expect(await verifySessionToken(session.token)).toBeNull();
  });

  it("clears a lockout, so a locked user can still reset their password", async () => {
    const user = await makeUser();
    for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
      await authenticateWithPassword(await loadUser(user._id), "nope");
    }
    expect(isLockedOut(await loadUser(user._id))).toBe(true);

    const { token } = await createPasswordResetToken(user._id);
    await redeemPasswordResetToken(token, "a new password");

    const reloaded = await loadUser(user._id);
    expect(reloaded.lockedUntil).toBeNull();
    expect(reloaded.failedLoginCount).toBe(0);
  });

  it("keeps the lockout from being extended past its window", async () => {
    const user = await makeUser();
    const now = new Date();
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { lockedUntil: new Date(now.getTime() + LOCKOUT_MS) } },
    );

    const stored = await loadUser(user._id);
    expect(isLockedOut(stored)).toBe(true);
    expect(isLockedOut(stored, new Date(now.getTime() + LOCKOUT_MS + 1))).toBe(
      false,
    );
  });
});
