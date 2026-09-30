import {
  authedPost,
  connectToDatabase,
  cookieNamed,
  cookieToken,
  createUser,
  disconnectDatabase,
  envelope,
  getWithCookie,
  postJson,
  postRaw,
  refusal,
  resetAuthTables,
} from "@tests/support/auth-contract";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as logoutAll } from "@/app/api/v1/auth/logout-all/route";
import { GET as me } from "@/app/api/v1/auth/me/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import {
  EmailVerificationTokenModel,
  MAX_FAILED_LOGINS,
  SessionModel,
  UserModel,
} from "@/modules/identity";
import { hashToken } from "@/modules/identity/password";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * Registration, sign-in, sign-out and the current-user endpoint, driven as HTTP.
 *
 * The real handlers, real cookies, a real database. The cookie attributes and
 * the refusal bodies are most of the contract of these endpoints and neither is
 * visible from a service test, so the suites call the routes.
 *
 * `register` is here rather than in the account suite because it is the
 * endpoint that issues the session, so the cookie assertions and the
 * registration assertions share one fixture.
 *
 * These tests never assert on a duration. Timing equalisation is verified by
 * asserting that the bcrypt work happened, because a test that measures elapsed
 * time is a test that measures the machine it ran on.
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

async function registerAda() {
  const response = await register(
    postJson("/register", { ...ADA, password: "correct horse battery staple" }),
  );
  expect(response.status).toBe(201);
  return response;
}

async function signIn(email = ADA.email) {
  const response = await login(
    postJson("/login", { email, password: "correct horse battery staple" }),
  );
  expect(response.status).toBe(200);
  return response;
}

describe("POST /auth/register", () => {
  it("creates the account, signs the user in, and points at the resource", async () => {
    const response = await register(
      postJson("/register", {
        ...ADA,
        password: "correct horse battery staple",
      }),
    );
    const body = await envelope<{ user: { id: string; email: string } }>(
      response,
    );

    expect(response.status).toBe(201);
    expect(body.data?.user.email).toBe("ada@example.com");

    // Both rows are real, not a response that merely claims to be. A handler
    // that skipped the session write would still pass a status assertion.
    const user = await UserModel.findOne({ email: ADA.email });
    expect(user).not.toBeNull();
    expect(await SessionModel.findOne({ userId: user?._id })).not.toBeNull();
  });

  it("never puts a password hash anywhere in the response", async () => {
    const raw = await registerAda().then((response) => response.text());

    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("$2b$12$");
    // The row does have one, so this is an assertion about the response rather
    // than about a system that never stored a password. `+passwordHash` is
    // required to read it at all: the field is `select: false`, which is the
    // second place the hash is kept out of reach.
    const stored = await UserModel.findOne({ email: ADA.email }).select(
      "+passwordHash",
    );
    expect(stored?.passwordHash).toBeTruthy();
  });

  it("sets an HttpOnly, SameSite, host-only session cookie", async () => {
    const header = cookieNamed(await registerAda(), SESSION_COOKIE) ?? "";

    expect(header).not.toBe("");
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\//i);
    // A `Domain` attribute would let a sibling subdomain overwrite the session
    // cookie. See the note in src/shared/auth/session-cookie.ts.
    expect(header).not.toMatch(/Domain=/i);
  });

  it("stores the session token hashed, so a database read yields no cookie", async () => {
    const token = cookieToken(await registerAda());
    const session = await SessionModel.findOne();

    expect(token).toBeTruthy();
    expect(session?.tokenHash).toBe(hashToken(token ?? ""));
    expect(session?.tokenHash).not.toBe(token);
  });

  it("names the resource it created", async () => {
    const response = await registerAda();
    const body = await envelope<{ user: { id: string } }>(response);

    expect(response.headers.get("location")).toBe(
      `/api/v1/users/${body.data?.user.id}`,
    );
  });

  it("returns no verification token, but still issues one", async () => {
    // A token in a JSON body is a token in every log, proxy and history on the
    // way there. The mailer in 1.32 is the only consumer, and it gets the row.
    const raw = await registerAda().then((response) => response.text());

    expect(raw).not.toMatch(/verificationToken/);
    expect(await EmailVerificationTokenModel.countDocuments({})).toBe(1);
  });

  it("reports a duplicate address as a conflict", async () => {
    await createUser({ email: ADA.email });

    const response = await register(
      postJson("/register", {
        ...ADA,
        password: "correct horse battery staple",
      }),
    );
    const body = await envelope(response);

    expect(response.status).toBe(409);
    expect(body.error?.code).toBe("EMAIL_ALREADY_REGISTERED");
  });
});

describe("POST /auth/login", () => {
  it("signs a user in and returns the public projection", async () => {
    await createUser(ADA);

    const response = await signIn();
    const raw = await response.text();

    expect(cookieToken(response)).toBeTruthy();
    expect(JSON.parse(raw).data.user.email).toBe(ADA.email);
    expect(raw).not.toContain("passwordHash");
  });

  it("records the sign-in time", async () => {
    const user = await createUser(ADA);
    expect(user.lastLoginAt ?? null).toBeNull();

    await signIn();

    expect((await UserModel.findById(user._id))?.lastLoginAt).toBeInstanceOf(
      Date,
    );
  });

  /**
   * The property this endpoint exists to have. Every way a sign-in can fail has
   * to look the same from outside, or the endpoint answers a question the caller
   * was not entitled to ask.
   */
  it("refuses an unknown address, a wrong password, a lockout and a suspension identically", async () => {
    const locked = await createUser({ email: "grace@example.com" });
    const suspended = await createUser({ email: "katherine@example.com" });
    await UserModel.updateOne(
      { _id: locked._id },
      { $set: { lockedUntil: new Date(Date.now() + 60_000) } },
    );
    await UserModel.updateOne(
      { _id: suspended._id },
      { $set: { status: "SUSPENDED" } },
    );
    await createUser(ADA);

    const attempts: Response[] = await Promise.all([
      login(
        postJson("/login", {
          email: "nobody@example.com",
          password: "whatever",
        }),
      ),
      login(
        postJson("/login", { email: ADA.email, password: "not the password" }),
      ),
      login(
        postJson("/login", {
          email: "grace@example.com",
          password: "whatever",
        }),
      ),
      login(
        postJson("/login", {
          email: "katherine@example.com",
          password: "whatever",
        }),
      ),
    ]);
    const refusals: { status: number; body: string }[] = await Promise.all(
      attempts.map(refusal),
    );
    const [first] = refusals;

    expect(first.status).toBe(401);
    for (const other of refusals.slice(1)) {
      expect(other).toEqual(first);
    }
    expect(first.body).toContain("UNAUTHENTICATED");
    // The comparison above would pass if every branch shared a code and
    // differed in message, or shared a message and differed in status. Asserted
    // on the raw bytes, so neither can hide behind it.
    expect(first.body).not.toMatch(/locked|suspend|exist|registered/i);
    expect(first.body).not.toContain(ADA.email);
  });

  it("sets no cookie on a refused sign-in", async () => {
    await createUser(ADA);

    const response = await login(
      postJson("/login", { email: ADA.email, password: "not it" }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("locks the account on the fifth consecutive failure", async () => {
    const user = await createUser(ADA);

    for (let attempt = 0; attempt < MAX_FAILED_LOGINS; attempt++) {
      await login(postJson("/login", { email: ADA.email, password: "wrong" }));
    }

    const stored = await UserModel.findById(user._id);
    expect(stored?.failedLoginCount).toBe(MAX_FAILED_LOGINS);
    expect(stored?.lockedUntil).toBeInstanceOf(Date);

    // The correct password no longer works either. That is the point of
    // locking: an attacker who keeps trying must not be able to keep going until
    // they guess it.
    const after = await login(
      postJson("/login", {
        email: ADA.email,
        password: "correct horse battery staple",
      }),
    );
    expect(after.status).toBe(401);
  });

  it("clears the counter on a successful sign-in", async () => {
    const user = await createUser(ADA);
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { failedLoginCount: 3 } },
    );

    await signIn();

    expect((await UserModel.findById(user._id))?.failedLoginCount).toBe(0);
  });

  it("normalises the address before looking it up", async () => {
    await createUser(ADA);

    const response = await login(
      postJson("/login", {
        email: "  ADA@Example.COM ",
        password: "correct horse battery staple",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("spends a bcrypt verification on every refused branch", async () => {
    // Not a timing assertion. What is asserted is that the work happened, which
    // is the part that could be refactored away while the timing equalisation
    // silently stops — and that a refactor which returned early from the locked
    // or suspended branch would be caught here rather than in production.
    const locked = await createUser({ email: "grace@example.com" });
    const suspended = await createUser({ email: "katherine@example.com" });
    await UserModel.updateOne(
      { _id: locked._id },
      { $set: { lockedUntil: new Date(Date.now() + 60_000) } },
    );
    await UserModel.updateOne(
      { _id: suspended._id },
      { $set: { status: "SUSPENDED" } },
    );

    const spy = vi.spyOn(
      await import("@/modules/identity/password"),
      "burnPasswordTiming",
    );

    await login(
      postJson("/login", { email: "nobody@example.com", password: "x" }),
    );
    await login(
      postJson("/login", { email: "grace@example.com", password: "x" }),
    );
    await login(
      postJson("/login", { email: "katherine@example.com", password: "x" }),
    );

    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session in the database, not just in the cookie", async () => {
    await createUser(ADA);
    const user = await UserModel.findOne({ email: ADA.email });
    const token = cookieToken(await signIn()) ?? "";

    const response = await logout(authedPost("/logout", {}, token));
    const body = await envelope<{ signedOut: boolean }>(response);

    expect(response.status).toBe(200);
    expect(body.data?.signedOut).toBe(true);
    expect(
      (await SessionModel.findOne({ userId: user?._id }))?.revokedAt,
    ).toBeInstanceOf(Date);
  });

  it("clears the session cookie with an immediate expiry", async () => {
    await createUser(ADA);
    const token = cookieToken(await signIn()) ?? "";

    const header =
      cookieNamed(
        await logout(authedPost("/logout", {}, token)),
        SESSION_COOKIE,
      ) ?? "";

    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header).toMatch(/Max-Age=0/i);
  });

  it("succeeds with no cookie at all", async () => {
    // A sign-out button must not report an error to somebody already signed out,
    // and refusing without a session would make this endpoint a way to ask
    // whether a given token is still good.
    const response = await logout(postRaw("/logout"));
    const body = await envelope<{ signedOut: boolean }>(response);

    expect(response.status).toBe(200);
    expect(body.data?.signedOut).toBe(true);
  });
});

describe("POST /auth/logout-all", () => {
  it("refuses without a session", async () => {
    const response = await logoutAll(postRaw("/logout-all"));
    const body = await envelope(response);

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHENTICATED");
  });

  it("revokes every session the user has and leaves other users alone", async () => {
    const ada = await createUser(ADA);
    const grace = await createUser({ email: "grace@example.com" });

    const tokens = await Promise.all([
      signIn(),
      signIn(),
      signIn(),
      signIn("grace@example.com"),
    ]);

    const response = await logoutAll(
      authedPost("/logout-all", {}, cookieToken(tokens[0]) ?? ""),
    );

    expect(response.status).toBe(200);
    expect(
      await SessionModel.countDocuments({ userId: ada._id, revokedAt: null }),
    ).toBe(0);
    // The neighbouring account is the boundary. "Revoke all" that reaches
    // across a missing user filter is a much worse bug than a slow one.
    expect(
      await SessionModel.countDocuments({ userId: grace._id, revokedAt: null }),
    ).toBe(1);
    // And this device's cookie is cleared too, or the browser keeps presenting a
    // token that is already revoked and every request 401s.
    expect(cookieNamed(response, SESSION_COOKIE)).toMatch(/Max-Age=0/i);
  });
});

describe("GET /auth/me", () => {
  it("401s without a session", async () => {
    const response = await me(getWithCookie(""));
    const body = await envelope(response);

    expect(response.status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHENTICATED");
  });

  it("401s on a token that was never issued", async () => {
    const response = await me(getWithCookie("not-a-real-token"));

    expect(response.status).toBe(401);
  });

  it("401s on a revoked session", async () => {
    await createUser(ADA);
    const token = cookieToken(await signIn()) ?? "";
    await logout(authedPost("/logout", {}, token));

    expect((await me(getWithCookie(token))).status).toBe(401);
  });

  it("describes a session with no active organisation instead of refusing", async () => {
    // A brand-new account is signed in with no organisation. That is a state to
    // render and offer to fix, not an error.
    await createUser(ADA);
    const token = cookieToken(await signIn()) ?? "";

    const response = await me(getWithCookie(token));
    const body = await envelope<{
      user: { email: string };
      organization: null;
      role: null;
      permissions: string[];
    }>(response);

    expect(response.status).toBe(200);
    expect(body.data?.user.email).toBe(ADA.email);
    expect(body.data?.organization).toBeNull();
    expect(body.data?.role).toBeNull();
    expect(body.data?.permissions).toEqual([]);
  });

  it("answers a session with an unusable organisation as ACTIVE_ORGANIZATION_REQUIRED", async () => {
    // A session pointing at an organisation the user is not an active member of.
    // The DAL answers this 403 rather than 401, which is a deliberate choice it
    // made: the session is real, the caller is authenticated, and the thing they
    // lack is an organisation. What must not happen is a *message* that differs
    // from the no-session one, so that is asserted.
    await createUser(ADA);
    const token = cookieToken(await signIn()) ?? "";
    const session = await SessionModel.findOne();
    await SessionModel.updateOne(
      { _id: session?._id },
      {
        $set: {
          activeOrganizationId: new (await import("mongoose")).Types.ObjectId(),
        },
      },
    );

    const response = await me(getWithCookie(token));
    const body = await envelope(response);

    expect(response.status).toBe(403);
    expect(body.error?.code).toBe("ACTIVE_ORGANIZATION_REQUIRED");
    expect(body.error?.message).not.toMatch(/session|cookie|token/i);
  });

  it("never includes a password hash", async () => {
    await createUser(ADA);
    const token = cookieToken(await signIn()) ?? "";

    const raw = await (await me(getWithCookie(token))).text();

    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("$2b$12$");
  });
});
