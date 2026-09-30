import {
  authedPost,
  connectToDatabase,
  cookieNamed,
  createUser,
  disconnectDatabase,
  envelope,
  postJson,
  postRaw,
  refusal,
  resetAuthTables,
} from "@tests/support/auth-contract";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as forgotPassword } from "@/app/api/v1/auth/forgot-password/route";
import { POST as resendVerification } from "@/app/api/v1/auth/resend-verification/route";
import { POST as resetPassword } from "@/app/api/v1/auth/reset-password/route";
import { POST as verifyEmail } from "@/app/api/v1/auth/verify-email/route";
import {
  createPasswordResetToken,
  EmailVerificationTokenModel,
  issueEmailVerificationToken,
  issueSession,
  PasswordResetTokenModel,
  redeemPasswordResetToken,
  SessionModel,
  UserModel,
} from "@/modules/identity";
import { hashToken, verifyPassword } from "@/modules/identity/password";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * Verification and password reset, driven as HTTP.
 *
 * The shape of these four endpoints is the same shape: a token goes out by
 * email and comes back in a body. Three properties carry the weight, and none
 * of them is visible in a successful response.
 *
 *  - Single use. A forwarded link must work once.
 *  - Indistinguishable refusals. "Expired", "already spent" and "never issued"
 *    are three answers to the same question, and returning which one happened
 *    turns a link into a way to test whether a token was ever real.
 *  - Supersession. Issuing a new link retires the old one, or a link mailed to
 *    an address an attacker controls stays redeemable for the rest of its life.
 */

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetAuthTables();
});

const ADA = { email: "ada@example.com", name: "Ada Lovelace" };
const NEW_PASSWORD = "a brand new correct horse";

describe("POST /auth/verify-email", () => {
  it("verifies the address and marks the token spent", async () => {
    const user = await createUser(ADA);
    const { token } = await issueEmailVerificationToken(user._id);

    const response = await verifyEmail(postJson("/verify-email", { token }));
    const body = await envelope<{
      verified: boolean;
      alreadyVerified: boolean;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.data?.verified).toBe(true);
    expect(body.data?.alreadyVerified).toBe(false);
    expect(
      (await UserModel.findById(user._id))?.emailVerifiedAt,
    ).toBeInstanceOf(Date);
    expect(
      (await EmailVerificationTokenModel.findOne({ userId: user._id }))?.usedAt,
    ).toBeInstanceOf(Date);
  });

  it("never echoes the token back", async () => {
    const user = await createUser(ADA);
    const { token } = await issueEmailVerificationToken(user._id);

    const raw = await (
      await verifyEmail(postJson("/verify-email", { token }))
    ).text();

    // A response body is the most durable place a credential can end up: it is
    // logged, cached and kept in browser history.
    expect(raw).not.toContain(token);
  });

  it("treats an expired and an invented token identically", async () => {
    // Not a spent token: a spent one is deliberately answered 200 when the
    // address it verified is already verified, which is the case below this one.
    // The requirement is that the two *unusable* kinds are indistinguishable.
    const user = await createUser(ADA);
    const { token: expired } = await issueEmailVerificationToken(user._id);
    await EmailVerificationTokenModel.updateOne(
      { tokenHash: hashToken(expired) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const bodies = await Promise.all(
      [expired, "never-issued-at-all"].map((token) =>
        verifyEmail(postJson("/verify-email", { token })).then(refusal),
      ),
    );

    expect(bodies[0].status).toBe(400);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0].body).toContain("TOKEN_NOT_REDEEMABLE");
  });

  it("reports a second click on a spent link as already verified, not as an error", async () => {
    // The user's intent — "this address is mine" — is already satisfied, and
    // returning a failure makes a link they have used look broken. This is the
    // case the route's own docblock promises, and the one the `alreadyVerified`
    // field exists for.
    const user = await createUser(ADA);
    const { token } = await issueEmailVerificationToken(user._id);
    await verifyEmail(postJson("/verify-email", { token }));

    const response = await verifyEmail(postJson("/verify-email", { token }));
    const body = await envelope<{
      verified: boolean;
      alreadyVerified: boolean;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.data?.verified).toBe(true);
    expect(body.data?.alreadyVerified).toBe(true);
  });

  it("lets exactly one of two concurrent redemptions verify the address", async () => {
    // The race a forwarded link creates. Both requests are built before either
    // runs, so the second genuinely overlaps the first rather than following it.
    //
    // Asserted on the write, not on the statuses. A single conditional update
    // means one caller claims the token and the other falls through to
    // `spentButVerified`, which answers 200 with `alreadyVerified: true` once the
    // winner has committed. Both statuses are therefore 200 and neither is
    // evidence of a double redemption; the evidence is that exactly one of them
    // performed the write.
    const user = await createUser(ADA);
    const { token } = await issueEmailVerificationToken(user._id);

    const responses = await Promise.all([
      verifyEmail(postJson("/verify-email", { token })),
      verifyEmail(postJson("/verify-email", { token })),
    ]);
    const bodies = await Promise.all(
      responses.map((response) =>
        envelope<{ alreadyVerified: boolean }>(response),
      ),
    );

    // Exactly one of the two claims the write. `data?.` rather than `data.`
    // because the helper types `data` as optional, and a missing `data` filters
    // out of the count rather than throwing, which fails the length assertion
    // below for the right reason.
    expect(
      bodies.filter((body) => body.data?.alreadyVerified === false),
    ).toHaveLength(1);
    expect(
      await EmailVerificationTokenModel.countDocuments({ usedAt: null }),
    ).toBe(0);
    expect(
      (await UserModel.findById(user._id))?.emailVerifiedAt,
    ).toBeInstanceOf(Date);
  });
});

describe("POST /auth/resend-verification", () => {
  it("refuses an unauthenticated caller", async () => {
    const response = await resendVerification(postRaw("/resend-verification"));
    const body = await envelope(response);

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHENTICATED");
  });

  it("supersedes the outstanding token and says nothing about the state of the address", async () => {
    // Authenticated, so the address is already known and no enumeration defence
    // is needed. The reply is identical whether or not the address was verified,
    // because telling a borrowed session the verification state is itself a leak.
    const user = await createUser(ADA);
    const { token: sessionToken } = await issueSession({ userId: user._id });
    const first = await issueEmailVerificationToken(user._id);

    const response = await resendVerification(
      authedPost("/resend-verification", {}, sessionToken),
    );
    const raw = await response.text();
    const body = JSON.parse(raw) as {
      data: { sent: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(body.data.sent).toBe(true);
    expect(raw).not.toMatch(/already verified/i);

    // The old link is dead and a new row exists, which is the whole point.
    const dead = await verifyEmail(
      postJson("/verify-email", { token: first.token }),
    );
    expect(dead.status).toBe(400);
    expect(await EmailVerificationTokenModel.countDocuments({})).toBe(2);
    expect(
      await EmailVerificationTokenModel.countDocuments({ usedAt: null }),
    ).toBe(1);
  });
});

describe("POST /auth/forgot-password", () => {
  it("answers identically for a registered and an unregistered address", async () => {
    // The oracle. A response that varied by existence turns this into a
    // membership test for the whole user table, and it is the reason the route
    // cannot read what the service returns.
    await createUser(ADA);

    const [known, unknown] = await Promise.all(
      [
        postJson("/forgot-password", { email: ADA.email }),
        postJson("/forgot-password", { email: "nobody@example.com" }),
      ].map((request) => forgotPassword(request).then(refusal)),
    );

    expect(known.status).toBe(200);
    expect(unknown).toEqual(known);
  });

  it("creates a token only for an address that has an account", async () => {
    await createUser(ADA);

    await forgotPassword(postJson("/forgot-password", { email: ADA.email }));
    await forgotPassword(
      postJson("/forgot-password", { email: "nobody@example.com" }),
    );

    expect(await PasswordResetTokenModel.countDocuments({})).toBe(1);
  });

  it("returns no token in the body", async () => {
    await createUser(ADA);

    const raw = await (
      await forgotPassword(postJson("/forgot-password", { email: ADA.email }))
    ).text();

    expect(raw).not.toMatch(/token/i);
    expect(raw).toContain("If that address has an account");
  });

  it("retires an outstanding reset link when a new one is issued", async () => {
    const user = await createUser(ADA);
    const first = await createPasswordResetToken(user._id);

    await forgotPassword(postJson("/forgot-password", { email: ADA.email }));

    const spent = await redeemPasswordResetToken(first.token, NEW_PASSWORD);
    expect(spent.ok).toBe(false);
  });
});

describe("POST /auth/reset-password", () => {
  it("changes the password, spends the token, revokes every session and clears the cookie", async () => {
    const user = await createUser(ADA);
    await SessionModel.create({
      userId: user._id,
      tokenHash: hashToken("an-existing-session"),
      activeOrganizationId: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastUsedAt: new Date(),
      revokedAt: null,
    });
    const { token } = await createPasswordResetToken(user._id);

    const response = await resetPassword(
      postJson("/reset-password", { token, password: NEW_PASSWORD }),
    );
    const body = await envelope<{ passwordChanged: boolean }>(response);

    expect(response.status).toBe(200);
    expect(body.data?.passwordChanged).toBe(true);

    const stored = await UserModel.findById(user._id).select("+passwordHash");
    expect(await verifyPassword(NEW_PASSWORD, stored?.passwordHash ?? "")).toBe(
      true,
    );
    expect(
      (await PasswordResetTokenModel.findOne({ userId: user._id }))?.usedAt,
    ).toBeInstanceOf(Date);
    // The part that is easy to leave out and is the reason a reset exists: an
    // attacker who prompted it must lose the session they were holding.
    expect(
      await SessionModel.countDocuments({ userId: user._id, revokedAt: null }),
    ).toBe(0);
    expect(cookieNamed(response, SESSION_COOKIE)).toMatch(/Max-Age=0/i);
  });

  it("clears the failure counter and any lockout", async () => {
    // Somebody resetting a password has usually just been locked out. Leaving
    // the lockout in place would tell them the reset worked and then refuse the
    // password they set.
    const user = await createUser(ADA);
    await UserModel.updateOne(
      { _id: user._id },
      {
        $set: {
          failedLoginCount: 5,
          lockedUntil: new Date(Date.now() + 600_000),
        },
      },
    );
    const { token } = await createPasswordResetToken(user._id);

    await resetPassword(
      postJson("/reset-password", { token, password: NEW_PASSWORD }),
    );

    const stored = await UserModel.findById(user._id);
    expect(stored?.failedLoginCount).toBe(0);
    expect(stored?.lockedUntil).toBeNull();
  });

  it("treats an expired, a spent and an invented token identically", async () => {
    const user = await createUser(ADA);
    const { token: good } = await createPasswordResetToken(user._id);
    const { token: expired } = await createPasswordResetToken(user._id);
    await PasswordResetTokenModel.updateOne(
      { tokenHash: hashToken(expired) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await resetPassword(
      postJson("/reset-password", { token: good, password: NEW_PASSWORD }),
    );

    const bodies = await Promise.all(
      [expired, good, "never-issued-at-all"].map((token) =>
        resetPassword(
          postJson("/reset-password", { token, password: NEW_PASSWORD }),
        ).then(refusal),
      ),
    );

    expect(bodies[0].status).toBe(400);
    for (const other of bodies.slice(1)) {
      expect(other).toEqual(bodies[0]);
    }
    expect(bodies[0].body).toContain("TOKEN_NOT_REDEEMABLE");
  });

  it("lets exactly one of two concurrent redemptions win", async () => {
    const user = await createUser(ADA);
    const { token } = await createPasswordResetToken(user._id);

    const responses = await Promise.all([
      resetPassword(
        postJson("/reset-password", { token, password: NEW_PASSWORD }),
      ),
      resetPassword(
        postJson("/reset-password", {
          token,
          password: "a different one entirely",
        }),
      ),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    // Exactly one password was written, and it is the winner's.
    const stored = await UserModel.findById(user._id).select("+passwordHash");
    const first = await verifyPassword(
      NEW_PASSWORD,
      stored?.passwordHash ?? "",
    );
    const second = await verifyPassword(
      "a different one entirely",
      stored?.passwordHash ?? "",
    );
    expect([first, second]).toContain(true);
  });
});
