import { Types } from "mongoose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  EmailVerificationTokenModel,
  issueEmailVerificationToken,
  PASSWORD_RESET_TTL_MINUTES,
  registerUser,
  EmailVerificationTokenModel as Tokens,
  toPublicUser,
  UserModel,
  verifyEmailToken,
} from "@/modules/identity";
import { hashToken } from "@/modules/identity/password";
import type { AppError } from "@/shared/errors/app-error";

/**
 * Registration and email verification.
 *
 * Two properties carry the weight here and neither is visible from a successful
 * response: the account and its verification token are created together or not
 * at all, and a verification link works exactly once even when it is redeemed
 * twice at the same moment.
 */

const DETAILS = {
  name: "Ada Lovelace",
  password: "correct horse battery staple",
};

beforeAll(async () => {
  await connectToDatabase();
});

beforeEach(async () => {
  await UserModel.deleteMany({});
  await EmailVerificationTokenModel.deleteMany({});
});

afterEach(async () => {
  await UserModel.deleteMany({});
  await EmailVerificationTokenModel.deleteMany({});
});

describe("registerUser", () => {
  it("creates the account and its verification token", async () => {
    const { user, userId, verificationToken } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });

    expect(user.email).toBe("ada@example.com");
    expect(user.emailVerified).toBe(false);
    expect(await UserModel.countDocuments({})).toBe(1);
    expect(await Tokens.countDocuments({ userId })).toBe(1);
    expect(verificationToken).toBeTypeOf("string");
  });

  it("stores only the digest of the verification token", async () => {
    // A leaked database backup must not yield a working verification link, for
    // the same reason the invitation token is digested.
    const { userId, verificationToken } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });

    const stored = await Tokens.findOne({ userId }).lean();
    expect(stored?.tokenHash).toBe(hashToken(verificationToken));
    expect(stored?.tokenHash).not.toBe(verificationToken);
  });

  it("normalises the email so one address cannot register twice", async () => {
    await registerUser({ ...DETAILS, email: "Ada@Example.COM" });
    const second = (await registerUser({
      ...DETAILS,
      email: "  ada@example.com  ",
    }).catch((caught: unknown) => caught)) as AppError;

    expect(second.code).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("reports a duplicate address as a conflict, not a driver error", async () => {
    await registerUser({ ...DETAILS, email: "ada@example.com" });

    const error = (await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    }).catch((caught: unknown) => caught)) as AppError;

    // A 11000 surfacing raw is a 500 and a support ticket; the caller needs to be
    // told the address is taken.
    expect(error.code).toBe("EMAIL_ALREADY_REGISTERED");
    expect(error.status).toBe(409);
    // The log-only reason names the index, not the address. `withApi` forwards
    // `internal` to warn-level logs, `redact` works on object keys and never
    // inspects a string, and `email` is not one of its sensitive keys — so an
    // address here is PII in a log line, once per duplicate registration.
    expect(error.internal).toMatch(/users email unique index/);
    expect(error.internal).not.toContain("ada@example.com");
  });

  it("keeps the duplicate address out of the response", async () => {
    await registerUser({ ...DETAILS, email: "ada@example.com" });

    const error = (await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    }).catch((caught: unknown) => caught)) as AppError;

    // EMAIL_ALREADY_REGISTERED is exposed, so a message carrying the address
    // would echo it back into a page. The log keeps it; the response does not.
    expect(error.message).not.toMatch(/ada@example\.com/);
  });

  it("does not leave an account behind when the token cannot be written", async () => {
    // The transaction is the point: an account with no way to verify cannot be
    // finished and is indistinguishable from one whose mail bounced.
    const original = EmailVerificationTokenModel.create.bind(
      EmailVerificationTokenModel,
    );
    EmailVerificationTokenModel.create = (() =>
      Promise.reject(new Error("write failed"))) as typeof original;

    try {
      await registerUser({ ...DETAILS, email: "ada@example.com" }).catch(
        () => {},
      );
    } finally {
      EmailVerificationTokenModel.create = original;
    }

    expect(await UserModel.countDocuments({})).toBe(0);
  });

  it("returns a token that actually verifies the address it created", async () => {
    // `withTransaction` retries on a write conflict, so anything generated
    // inside it changes on the retry. A retried registration that returned a
    // fresh token would hand back a link that has never worked.
    const { userId, verificationToken } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });

    const result = await verifyEmailToken(verificationToken);

    expect(result.ok).toBe(true);
    const stored = await UserModel.findById(userId).lean();
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("reports verification as a boolean rather than a date", async () => {
    const { user, userId, verificationToken } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });
    expect(user.emailVerified).toBe(false);

    await verifyEmailToken(verificationToken);
    const stored = await UserModel.findById(userId);

    expect(toPublicUser(stored!).emailVerified).toBe(true);
  });
});

describe("issueEmailVerificationToken", () => {
  it("returns a token that works", async () => {
    const { userId } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });

    const { token } = await issueEmailVerificationToken(userId);

    expect((await verifyEmailToken(token)).ok).toBe(true);
  });

  it("invalidates the token it replaces", async () => {
    // Reissue is a reissue, not an addition. A user who requested three links
    // and used the first has proved they can read the address, so the other two
    // are live credentials for nothing.
    const { userId, verificationToken } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });
    await issueEmailVerificationToken(userId);

    expect((await verifyEmailToken(verificationToken)).ok).toBe(false);
  });

  it("leaves exactly one usable token", async () => {
    const { userId } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });

    await issueEmailVerificationToken(userId);
    await issueEmailVerificationToken(userId);

    expect(await Tokens.countDocuments({ userId, usedAt: null })).toBe(1);
  });
});

describe("verifyEmailToken", () => {
  it("marks the address verified", async () => {
    const { userId, verificationToken } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });

    const result = await verifyEmailToken(verificationToken);

    expect(result).toEqual({ ok: true, alreadyVerified: false });
    expect(
      (await UserModel.findById(userId).lean())?.emailVerifiedAt,
    ).toBeInstanceOf(Date);
  });

  it("refuses a second redemption of the same link", async () => {
    const { verificationToken } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });
    await verifyEmailToken(verificationToken);

    // A forwarded link must not work twice.
    expect((await verifyEmailToken(verificationToken)).ok).toBe(false);
  });

  it("lets only one of two simultaneous redemptions succeed", async () => {
    const { verificationToken } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });

    // A read-then-write check would leave a window in which both succeed.
    const results = await Promise.all([
      verifyEmailToken(verificationToken),
      verifyEmailToken(verificationToken),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("refuses an expired token", async () => {
    const { verificationToken } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });
    const later = new Date(
      Date.now() + (EMAIL_VERIFICATION_TTL_HOURS + 1) * 3600_000,
    );

    expect((await verifyEmailToken(verificationToken, later)).ok).toBe(false);
  });

  it("refuses a token that never existed", async () => {
    expect((await verifyEmailToken("not-a-real-token")).ok).toBe(false);
  });

  it("answers identically for expired, used and invented tokens", async () => {
    // Three different answers to the same question from outside the system would
    // turn a verification link into a way to test whether a token was real.
    const used = await registerUser({ ...DETAILS, email: "used@example.com" });
    await verifyEmailToken(used.verificationToken);

    const expired = await registerUser({
      ...DETAILS,
      email: "expired@example.com",
    });
    const afterExpiry = new Date(
      Date.now() + (EMAIL_VERIFICATION_TTL_HOURS + 1) * 3600_000,
    );

    const results = await Promise.all([
      verifyEmailToken(used.verificationToken),
      verifyEmailToken(expired.verificationToken, afterExpiry),
      verifyEmailToken("never-existed"),
    ]);

    for (const result of results) expect(result).toEqual({ ok: false });
  });

  it("reports an already-verified address rather than looking like a no-op", async () => {
    const { userId, verificationToken } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });
    await verifyEmailToken(verificationToken);

    // The link worked; the account was simply already verified. The UI can say
    // so instead of appearing to have failed.
    const { token } = await issueEmailVerificationToken(userId);
    const result = await verifyEmailToken(token);

    expect(result).toEqual({ ok: true, alreadyVerified: true });
  });
});

describe("the two token collections", () => {
  it("do not share a TTL, which is why they are separate", () => {
    // Copy-pasting a TTL between them is the mistake this guards, and it is
    // invisible until somebody's verification mail expires an hour after it was
    // sent - or, worse, until one collection's cleanup index evicts the other's
    // valid tokens.
    expect(EMAIL_VERIFICATION_TTL_HOURS).not.toBe(PASSWORD_RESET_TTL_MINUTES);
  });

  it("store in different collections, so a leaked reset link cannot verify", () => {
    expect(EmailVerificationTokenModel.collection.collectionName).toBe(
      "email_verification_tokens",
    );
  });

  it("clean up on their own expiry", () => {
    const ttl = EmailVerificationTokenModel.schema
      .indexes()
      .find(([spec]) => "expiresAt" in spec);

    expect(ttl?.[1]?.expireAfterSeconds).toBe(0);
  });

  it("issue distinct digests for the same user", async () => {
    const { userId, verificationToken } = await registerUser({
      ...DETAILS,
      email: "ada@example.com",
    });
    const { token } = await issueEmailVerificationToken(userId);

    // A shared digest would mean one link verifies the other's account.
    expect(hashToken(token)).not.toBe(hashToken(verificationToken));
    expect(await Tokens.countDocuments({ userId })).toBe(2);
  });

  it("keys tokens by user so a throttle can read the newest first", () => {
    const specs = EmailVerificationTokenModel.schema
      .indexes()
      .map(([spec]) => spec);
    expect(specs).toContainEqual({ userId: 1, createdAt: -1 });
  });
});

describe("sanity", () => {
  it("uses ObjectIds, not strings, for the user reference", () => {
    // A string here would silently stop matching after a schema change.
    const path = EmailVerificationTokenModel.schema.path("userId");
    expect(path.instance).toBe("ObjectId");
    expect(new Types.ObjectId()).toBeInstanceOf(Types.ObjectId);
  });
});
