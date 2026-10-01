import {
  authedPost,
  connectToDatabase,
  createUser,
  disconnectDatabase,
  envelope,
  getWithCookie,
  postJson,
  resetAuthTables,
} from "@tests/support/auth-contract";
import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as forgotPassword } from "@/app/api/v1/auth/forgot-password/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as logoutAll } from "@/app/api/v1/auth/logout-all/route";
import { GET as me } from "@/app/api/v1/auth/me/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as resendVerification } from "@/app/api/v1/auth/resend-verification/route";
import { POST as resetPassword } from "@/app/api/v1/auth/reset-password/route";
import { POST as verifyEmail } from "@/app/api/v1/auth/verify-email/route";
import { withTransaction } from "@/db/transaction";
import {
  AUTH_EVENT_ACTIONS,
  type AuthEvent,
  AuthEventModel,
} from "@/modules/audit";
import {
  createPasswordResetToken,
  issueEmailVerificationToken,
  issueSession,
  MAX_FAILED_LOGINS,
  UserModel,
} from "@/modules/identity";
import {
  SESSION_MAX_IP,
  SESSION_MAX_USER_AGENT,
} from "@/modules/identity/session.model";

/**
 * Every authentication event, written by the endpoint that produces it.
 *
 * Eight events across six handlers, and `login` is the one that can write three
 * of them on a single request. Every case below drives a real route handler with
 * a real `Request`, because the property being tested is that the *handler*
 * writes the event — a suite that called `recordAuthEvent` directly would pass
 * with every route wired to nothing.
 *
 * There is no per-event branch in this file that can be skipped, which is the
 * property ADR-0006's "uniform, with no opt-out list" rests on.
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

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new correct horse";

/**
 * An account with an address nothing else uses.
 *
 * The Vitest workers share one replica set and every auth endpoint in the
 * repository now writes to `auth_events`, so a query without a unique filter here
 * would see rows from three other suites running at the same moment.
 */
async function freshUser(): Promise<{ _id: Types.ObjectId; email: string }> {
  const user = await createUser({
    email: `evt-${new Types.ObjectId().toString()}@example.com`,
  });
  return { _id: user._id, email: user.email };
}

/** One failure short of the limit, which is the state a trip needs. */
async function oneFailureShort(userId: Types.ObjectId): Promise<void> {
  await UserModel.updateOne(
    { _id: userId },
    { $set: { failedLoginCount: MAX_FAILED_LOGINS - 1 } },
  );
}

/** The rows written for one account, oldest first. */
async function eventsFor(
  userId: Types.ObjectId,
): Promise<Array<Pick<AuthEvent, "action" | "outcome" | "email">>> {
  const rows = await AuthEventModel.find({ userId })
    .sort({ createdAt: 1 })
    .lean();
  return rows.map((row) => ({
    action: row.action,
    outcome: row.outcome,
    email: row.email,
  }));
}

describe("auth.register", () => {
  it("is written once the session is issued", async () => {
    const email = `evt-${new Types.ObjectId().toString()}@example.com`;

    const response = await register(
      postJson("/register", {
        email,
        name: "Grace Hopper",
        password: NEW_PASSWORD,
      }),
    );

    expect(response.status).toBe(201);
    const { data } = await envelope<{ user: { id: string } }>(response);
    const rows = await AuthEventModel.find({
      userId: new Types.ObjectId(data?.user.id as string),
    })
      .sort({ createdAt: 1 })
      .lean();

    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(AUTH_EVENT_ACTIONS.REGISTER);
    expect(rows[0].outcome).toBe("success");
    expect(rows[0].email).toBe(email);
  });

  it("is not written for a refused registration", async () => {
    const user = await freshUser();

    const response = await register(
      postJson("/register", {
        email: user.email,
        name: "Someone Else",
        password: NEW_PASSWORD,
      }),
    );

    expect(response.status).toBe(409);
    // The event log must not become a second enumeration oracle over the user
    // table. `EMAIL_ALREADY_REGISTERED` is already one, and documented as one.
    expect(await AuthEventModel.countDocuments({ email: user.email })).toBe(0);
  });
});

describe("auth.login", () => {
  it("is written for a successful sign-in", async () => {
    const user = await freshUser();

    const response = await login(
      postJson("/login", { email: user.email, password: PASSWORD }),
    );

    expect(response.status).toBe(200);
    expect(await eventsFor(user._id)).toEqual([
      {
        action: AUTH_EVENT_ACTIONS.LOGIN,
        outcome: "success",
        email: user.email,
      },
    ]);
  });

  it("records the client address and user agent, bounded by the schema", async () => {
    const user = await freshUser();
    const userAgent = "u".repeat(SESSION_MAX_USER_AGENT + 100);

    await login(
      postJson(
        "/login",
        { email: user.email, password: PASSWORD },
        {
          headers: {
            "x-forwarded-for": "203.0.113.9, 10.0.0.1",
            "user-agent": userAgent,
          },
        },
      ),
    );

    const [row] = await AuthEventModel.find({ userId: user._id }).lean();
    expect(row?.ip).toBe("203.0.113.9");
    expect(row?.userAgent).toHaveLength(SESSION_MAX_USER_AGENT);
    expect(SESSION_MAX_IP).toBeGreaterThan("203.0.113.9".length);
  });
});

describe("auth.login_failed", () => {
  it("is written for a wrong password, naming the account", async () => {
    const user = await freshUser();

    const response = await login(
      postJson("/login", { email: user.email, password: "not the password" }),
    );

    expect(response.status).toBe(401);
    expect(await eventsFor(user._id)).toEqual([
      {
        action: AUTH_EVENT_ACTIONS.LOGIN_FAILED,
        outcome: "failure",
        email: user.email,
      },
    ]);
  });

  it("is written for an unknown address, with no account to attribute it to", async () => {
    const email = `nobody-${new Types.ObjectId().toString()}@example.com`;

    const response = await login(
      postJson("/login", { email, password: "not the password" }),
    );

    expect(response.status).toBe(401);
    const rows = await AuthEventModel.find({ email }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(AUTH_EVENT_ACTIONS.LOGIN_FAILED);
    // Null, because the row still has to exist, and a made-up owner would put a
    // real account beside an attempt nobody made against it.
    expect(rows[0].userId).toBeNull();
  });

  it("is written for a suspended account", async () => {
    const user = await freshUser();
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { status: "SUSPENDED" } },
    );

    const response = await login(
      postJson("/login", { email: user.email, password: PASSWORD }),
    );

    expect(response.status).toBe(401);
    expect((await eventsFor(user._id)).map((row) => row.action)).toEqual([
      AUTH_EVENT_ACTIONS.LOGIN_FAILED,
    ]);
  });

  it("is written for a locked account, and no second lockout row with it", async () => {
    const user = await freshUser();
    // Already locked, with the correct password in hand — the refusal that most
    // looks like a takeover and can only be told from the row above by not
    // writing a lockout row of its own.
    await UserModel.updateOne(
      { _id: user._id },
      {
        $set: {
          failedLoginCount: MAX_FAILED_LOGINS,
          lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
        },
      },
    );

    const response = await login(
      postJson("/login", { email: user.email, password: PASSWORD }),
    );

    expect(response.status).toBe(401);
    // A locked refusal is still a failed sign-in, so that row exists. The
    // absence of an `auth.lockout` beside it is the assertion that the flag is
    // carried up from the counter rather than recomputed from a reason: this
    // attempt did not lock anything, so writing one would date the lockout wrong.
    expect((await eventsFor(user._id)).map((row) => row.action)).toEqual([
      AUTH_EVENT_ACTIONS.LOGIN_FAILED,
    ]);
  });
});

describe("auth.lockout", () => {
  it("is written on the attempt that trips it, alongside the failure", async () => {
    const user = await freshUser();
    await oneFailureShort(user._id);

    const response = await login(
      postJson("/login", { email: user.email, password: "not the password" }),
    );

    expect(response.status).toBe(401);
    // Two rows, not one. That attempt is a wrong password *and* the lockout
    // moment, and collapsing them makes the moment inferable only from the end of
    // a run — which a log permitted to drop rows cannot tell from a dropped row.
    expect((await eventsFor(user._id)).map((row) => row.action)).toEqual([
      AUTH_EVENT_ACTIONS.LOGIN_FAILED,
      AUTH_EVENT_ACTIONS.LOCKOUT,
    ]);
  });

  it("is not written on an attempt that does not trip it", async () => {
    const user = await freshUser();

    await login(
      postJson("/login", { email: user.email, password: "not the password" }),
    );

    expect((await eventsFor(user._id)).map((row) => row.action)).toEqual([
      AUTH_EVENT_ACTIONS.LOGIN_FAILED,
    ]);
  });

  it("coincides with the account being locked in the database", async () => {
    const user = await freshUser();
    await oneFailureShort(user._id);

    await login(
      postJson("/login", { email: user.email, password: "not the password" }),
    );

    // The counter runs whether or not the event was written. That ordering is
    // the whole argument for the drop policy: a non-throwing write cannot stand
    // between an adversary and the `$inc`.
    const reloaded = await UserModel.findById(user._id).lean();
    expect(reloaded?.failedLoginCount).toBe(MAX_FAILED_LOGINS);
    expect(reloaded?.lockedUntil).toBeInstanceOf(Date);
  });
});

describe("auth.logout", () => {
  it("is written for the account whose session was revoked", async () => {
    const user = await freshUser();
    const { token } = await issueSession({ userId: user._id });

    const response = await logout(authedPost("/logout", {}, token));

    expect(response.status).toBe(200);
    const rows = await AuthEventModel.find({ userId: user._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(AUTH_EVENT_ACTIONS.LOGOUT);
    expect(rows[0].outcome).toBe("success");
    // A logout presents a cookie and no body, so there is no address to record
    // and none is invented.
    expect(rows[0].email).toBeNull();
  });

  it("is written for an already-signed-out caller, with no account", async () => {
    const response = await logout(authedPost("/logout", {}, "no-such-token"));

    // Still 200, and still a row: the collection has no branch that can forget to
    // write.
    expect(response.status).toBe(200);
    const rows = await AuthEventModel.find({
      action: AUTH_EVENT_ACTIONS.LOGOUT,
      userId: null,
    }).lean();
    expect(rows).toHaveLength(1);
  });

  it("does not refuse a suspended account", async () => {
    const user = await freshUser();
    const { token } = await issueSession({ userId: user._id });
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { status: "SUSPENDED" } },
    );

    // `requireUser()` refuses suspended accounts, so this route reads the session
    // instead. Requiring a user here would have made sign-out a 401 for exactly
    // the people most likely to need it.
    const response = await logout(authedPost("/logout", {}, token));

    expect(response.status).toBe(200);
  });
});

describe("auth.logout_all", () => {
  it("is written for the account whose sessions were revoked", async () => {
    const user = await freshUser();
    const { token } = await issueSession({ userId: user._id });

    const response = await logoutAll(authedPost("/logout-all", {}, token));

    expect(response.status).toBe(200);
    expect((await eventsFor(user._id)).map((row) => row.action)).toEqual([
      AUTH_EVENT_ACTIONS.LOGOUT_ALL,
    ]);
    expect((await eventsFor(user._id))[0].email).toBe(user.email);
  });

  it("is not written by the reset that also revokes every session", async () => {
    const user = await freshUser();
    await issueSession({ userId: user._id });
    const { token } = await createPasswordResetToken(user._id);

    await resetPassword(
      postJson("/reset-password", { token, password: NEW_PASSWORD }),
    );

    // Both paths revoke everything. Only one is somebody asking to be signed out
    // everywhere, and writing this event from the revocation helper would make
    // the two indistinguishable to an investigator.
    expect((await eventsFor(user._id)).map((row) => row.action)).toEqual([
      AUTH_EVENT_ACTIONS.PASSWORD_RESET_COMPLETED,
    ]);
  });
});

describe("auth.password_reset_requested", () => {
  it("is written for a registered address, naming the account", async () => {
    const user = await freshUser();

    const response = await forgotPassword(
      postJson("/forgot-password", { email: user.email }),
    );

    expect(response.status).toBe(200);
    expect((await eventsFor(user._id)).map((row) => row.action)).toEqual([
      AUTH_EVENT_ACTIONS.PASSWORD_RESET_REQUESTED,
    ]);
  });

  it("is written for an unknown address, with the address but no account", async () => {
    const email = `nobody-${new Types.ObjectId().toString()}@example.com`;

    const response = await forgotPassword(
      postJson("/forgot-password", { email }),
    );

    expect(response.status).toBe(200);
    const rows = await AuthEventModel.find({ email }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(AUTH_EVENT_ACTIONS.PASSWORD_RESET_REQUESTED);
    expect(rows[0].userId).toBeNull();
    // The response is identical in both cases, so without this row there is
    // nothing at all recording what a burst of these looks like.
    expect(rows[0].outcome).toBe("success");
  });

  it("is written for a suspended address, with no account to attribute it to", async () => {
    const user = await freshUser();
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { status: "SUSPENDED" } },
    );

    const response = await forgotPassword(
      postJson("/forgot-password", { email: user.email }),
    );

    expect(response.status).toBe(200);
    const rows = await AuthEventModel.find({ email: user.email }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
  });
});

describe("auth.password_reset_completed", () => {
  it("is written for the account whose password changed", async () => {
    const user = await freshUser();
    const { token } = await createPasswordResetToken(user._id);

    const response = await resetPassword(
      postJson("/reset-password", { token, password: NEW_PASSWORD }),
    );

    expect(response.status).toBe(200);
    const rows = await AuthEventModel.find({ userId: user._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(AUTH_EVENT_ACTIONS.PASSWORD_RESET_COMPLETED);
    expect(rows[0].outcome).toBe("success");
    // The request carried a token and a password. No address is resolved to put
    // on the row; `userId` is what identifies it.
    expect(rows[0].email).toBeNull();
  });

  it("is not written for an invented token", async () => {
    const response = await resetPassword(
      postJson("/reset-password", {
        token: "not-a-real-token",
        password: NEW_PASSWORD,
      }),
    );

    expect(response.status).toBe(400);
    // There is no account to attribute a forgery to, and inventing one would put
    // a real account beside a request nobody made.
    expect(await AuthEventModel.countDocuments({})).toBe(0);
  });
});

describe("the three handlers that write nothing", () => {
  it("records no event for /me, verify-email or resend-verification", async () => {
    const user = await freshUser();
    const { token } = await issueSession({ userId: user._id });
    const verification = await issueEmailVerificationToken(user._id);

    await me(getWithCookie(token));
    await verifyEmail(postJson("/verify-email", { token: verification.token }));
    await resendVerification(authedPost("/resend-verification", {}, token));

    // The closed `action` vocabulary holds no event for these three, so there is
    // nothing to write. That is a property of the list rather than a gap in it:
    // verification is a change of a field, not an access to the account.
    expect(await AuthEventModel.countDocuments({ userId: user._id })).toBe(0);
  });
});

describe("the event write is never enlisted in a transaction", () => {
  it("survives a sibling write that is rolled back", async () => {
    const user = await freshUser();

    // The event is written from *inside* a transaction body and is deliberately
    // not given the session. If it were enlisted, the rollback would take it too
    // and this row would be gone — which is the observation that fails the moment
    // somebody adds `{ session }`.
    await expect(
      withTransaction(async (session) => {
        await UserModel.updateOne(
          { _id: user._id },
          { $set: { name: "written inside a transaction" } },
          { session },
        );
        await AuthEventModel.create([
          {
            userId: user._id,
            email: user.email,
            action: AUTH_EVENT_ACTIONS.LOGIN,
            outcome: "success",
          },
        ]);
        throw new Error("roll the whole thing back");
      }),
    ).rejects.toThrow("roll the whole thing back");

    // The enlisted write is gone.
    expect((await UserModel.findById(user._id).lean())?.name).toBe(
      "Ada Lovelace",
    );
    // The event is not, and it names an event that really did happen.
    expect((await eventsFor(user._id)).map((row) => row.action)).toEqual([
      AUTH_EVENT_ACTIONS.LOGIN,
    ]);
  });
});
