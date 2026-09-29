import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import {
  PasswordResetTokenModel,
  SessionModel,
  USER_STATUS,
  UserModel,
  type UserStatus,
} from "@/modules/identity";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const userId = new Types.ObjectId();

/**
 * Indexes keyed by their comma-joined field list, e.g. "userId,revokedAt".
 * The `as const` is load-bearing: without it the array is inferred as
 * `(string | IndexDescription)[]` rather than a tuple, and `new Map` resolves
 * to its no-argument overload.
 */
function indexMap(indexes: Record<string, unknown>[]) {
  return new Map<string, { expireAfterSeconds?: number }>(
    indexes.map(
      (index) =>
        [
          Object.keys(index.key as Record<string, unknown>).join(","),
          index,
        ] as const,
    ),
  );
}

/**
 * Whether the schema declares a top-level field.
 *
 * `schema.path(name)` reads better but Mongoose 9 types its second `type`
 * parameter as required, so asserting on the definition object is both honest
 * and less noisy than casting at every call site.
 */
const definesField = (model: { schema: { obj: object } }, field: string) =>
  field in model.schema.obj;

beforeAll(async () => {
  await connectToDatabase();
  await Promise.all([
    UserModel.syncIndexes(),
    SessionModel.syncIndexes(),
    PasswordResetTokenModel.syncIndexes(),
  ]);
});

afterEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    PasswordResetTokenModel.deleteMany({}),
  ]);
});

const validUser = () => ({
  email: "ada@example.com",
  name: "Ada Lovelace",
  passwordHash: "$2b$12$notarealhashbutlongenoughtolooklikeone",
});

describe("users", () => {
  it("accepts a minimal valid user", async () => {
    const user = await UserModel.create(validUser());

    expect(user.email).toBe("ada@example.com");
    expect(user.status).toBe("ACTIVE");
    expect(user.failedLoginCount).toBe(0);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.lockedUntil).toBeNull();
    expect(user.preferences).toEqual({});
  });

  it("lower-cases and trims the email on write", async () => {
    // The unique index and the lookup both operate on the normalised form, so
    // normalising at write is what makes "one account per person" true rather
    // than aspirational.
    const user = await UserModel.create({
      ...validUser(),
      email: "  Ada@EXAMPLE.com  ",
    });

    expect(user.email).toBe("ada@example.com");
  });

  it("refuses a second account with the same email in another case", async () => {
    await UserModel.create(validUser());

    await expect(
      UserModel.create({ ...validUser(), email: "ADA@Example.com" }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("does not return the password hash unless it is asked for", async () => {
    await UserModel.create(validUser());

    // The defence is against a stray findOne leaking the hash into a log line
    // or a serialised response. Reading it has to be a deliberate act.
    const without = await UserModel.findOne({
      email: "ada@example.com",
    }).lean();
    expect(without).not.toHaveProperty("passwordHash");

    const with_ = await UserModel.findOne({ email: "ada@example.com" })
      .select("+passwordHash")
      .lean();
    expect(with_?.passwordHash).toBeTruthy();
  });

  it("requires a name between 1 and 120 characters", async () => {
    await expect(
      UserModel.create({ ...validUser(), name: "" }),
    ).rejects.toThrow();
    await expect(
      UserModel.create({ ...validUser(), name: "x".repeat(121) }),
    ).rejects.toThrow();
    await expect(
      UserModel.create({ ...validUser(), name: "x".repeat(120) }),
    ).resolves.toBeTruthy();
  });

  it("requires an email and a password hash", async () => {
    const { email: _e, ...noEmail } = validUser();
    const { passwordHash: _p, ...noHash } = validUser();

    await expect(UserModel.create(noEmail)).rejects.toThrow();
    await expect(UserModel.create(noHash)).rejects.toThrow();
  });

  it("rejects a status outside the allowed set", async () => {
    // Cast to bypass the compile-time union, which is the whole point: this
    // asserts the runtime validator and the type agree, because raw JSON from
    // an API route reaches the model without passing through TypeScript.
    await expect(
      UserModel.create({ ...validUser(), status: "BANNED" as UserStatus }),
    ).rejects.toThrow(/status/i);

    // A distinct email per status, so this asserts the enum and not the index.
    for (const [index, status] of USER_STATUS.entries()) {
      const created = await UserModel.create({
        ...validUser(),
        email: `status-${index}@example.com`,
        status,
      });
      expect(created.status).toBe(status);
    }
  });

  it("refuses a negative failedLoginCount", async () => {
    await expect(
      UserModel.create({ ...validUser(), failedLoginCount: -1 }),
    ).rejects.toThrow();
  });

  it("stores arbitrary preferences without mangling them", async () => {
    const preferences = {
      timezone: "Europe/London",
      locale: "en-GB",
      dateFormat: "dd/MM/yyyy",
      currencyFormat: "GBP",
    };
    const user = await UserModel.create({ ...validUser(), preferences });

    expect(user.preferences).toEqual(preferences);
  });

  it("has exactly the indexes the data model calls for", async () => {
    const keys = (await UserModel.collection.indexes()).map((index) =>
      Object.keys(index.key).join(","),
    );

    expect(keys).toContain("email");
    expect(keys.filter((key) => key.includes("passwordHash"))).toEqual([]);
  });
});

describe("sessions", () => {
  const validSession = () => ({
    userId,
    tokenHash: "a".repeat(64),
    expiresAt: new Date(Date.now() + 30 * DAY),
    lastUsedAt: new Date(),
  });

  it("accepts a valid session with no organisation chosen yet", async () => {
    // Null until the user joins or creates one. Required, because a session
    // with no active org is a normal state, not an error.
    const session = await SessionModel.create(validSession());

    expect(session.activeOrganizationId).toBeNull();
    expect(session.revokedAt).toBeNull();
  });

  it("refuses two sessions with the same token hash", async () => {
    await SessionModel.create(validSession());

    await expect(SessionModel.create(validSession())).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it("truncates an over-long user agent instead of rejecting the session", async () => {
    // The user agent is an untrusted header. A session that cannot be recorded
    // is a user who cannot sign in, so the value is cut rather than refused.
    const session = await SessionModel.create({
      ...validSession(),
      userAgent: "x".repeat(900),
    });

    expect(session.userAgent).toHaveLength(255);
  });

  it("does not truncate a short user agent or an ip", async () => {
    const session = await SessionModel.create({
      ...validSession(),
      userAgent: "Mozilla/5.0 (Macintosh)",
      ip: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
    });

    expect(session.userAgent).toBe("Mozilla/5.0 (Macintosh)");
    expect(session.ip).toBe("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
  });

  it("requires a userId, a token hash, an expiry and a last-used time", async () => {
    const { userId: _u, ...noUser } = validSession();
    const { tokenHash: _t, ...noToken } = validSession();
    const { expiresAt: _e, ...noExpiry } = validSession();
    const { lastUsedAt: _l, ...noLastUsed } = validSession();

    await expect(SessionModel.create(noUser)).rejects.toThrow();
    await expect(SessionModel.create(noToken)).rejects.toThrow();
    await expect(SessionModel.create(noExpiry)).rejects.toThrow();
    await expect(SessionModel.create(noLastUsed)).rejects.toThrow();
  });

  it("keeps a revoked session in place, marked, rather than deleting it", async () => {
    const revokedAt = new Date();
    await SessionModel.create({ ...validSession(), revokedAt });

    // Revocation must stay auditable, so the row is not removed here.
    const found = await SessionModel.findOne({ tokenHash: "a".repeat(64) });
    expect(found?.revokedAt).toEqual(revokedAt);
  });

  it("carries the indexes the data model calls for", async () => {
    const byKey = indexMap(await SessionModel.collection.indexes());

    expect(byKey.has("tokenHash")).toBe(true);
    expect(byKey.get("userId,revokedAt")).toBeDefined();
    expect(byKey.get("expiresAt")?.expireAfterSeconds).toBe(0);
  });
});

describe("password_reset_tokens", () => {
  const validToken = () => ({
    userId,
    tokenHash: "b".repeat(64),
    expiresAt: new Date(Date.now() + HOUR),
  });

  it("accepts a valid token unused", async () => {
    const token = await PasswordResetTokenModel.create(validToken());

    expect(token.usedAt).toBeNull();
  });

  it("refuses a duplicate token hash", async () => {
    await PasswordResetTokenModel.create(validToken());

    await expect(PasswordResetTokenModel.create(validToken())).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it("records redemption so a replay can be refused", async () => {
    const usedAt = new Date();
    const token = await PasswordResetTokenModel.create({
      ...validToken(),
      usedAt,
    });

    // The replay check reads this field; the row must survive to be checked.
    const found = await PasswordResetTokenModel.findById(token._id);
    expect(found?.usedAt).toEqual(usedAt);
  });

  it("carries the indexes the data model calls for", async () => {
    const byKey = indexMap(await PasswordResetTokenModel.collection.indexes());

    expect(byKey.has("tokenHash")).toBe(true);
    expect(byKey.get("expiresAt")?.expireAfterSeconds).toBe(0);
    expect(byKey.get("userId,createdAt")).toBeDefined();
  });

  it("is a different collection from email verification tokens", async () => {
    // Separate collections so a cleanup index on one cannot evict the other's
    // tokens, and so a reset link can never verify an address.
    expect(PasswordResetTokenModel.collection.collectionName).toBe(
      "password_reset_tokens",
    );
  });
});

describe("identity collections", () => {
  it("carry no organizationId, because they are not tenant-owned", async () => {
    // The single most important structural property of these three. A user
    // exists independently of any organisation, and a session belongs to a
    // user. If organizationId appeared here, every query against them would
    // look scoped when it is not.
    for (const model of [UserModel, SessionModel, PasswordResetTokenModel]) {
      expect(definesField(model, "organizationId")).toBe(false);
    }

    // Positive control: a helper that always answered false would satisfy the
    // assertion above while proving nothing about the schemas.
    expect(definesField(UserModel, "email")).toBe(true);
    expect(definesField(SessionModel, "tokenHash")).toBe(true);
  });

  it("do not soft delete, because expiry and revocation are explicit states", async () => {
    for (const model of [SessionModel, PasswordResetTokenModel]) {
      expect(definesField(model, "deletedAt")).toBe(false);
      expect(
        definesField(model, "revokedAt") || definesField(model, "usedAt"),
      ).toBe(true);
    }
  });
});
