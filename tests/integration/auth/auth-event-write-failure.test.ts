import {
  authedPost,
  createUser,
  postJson,
  refusal,
  resetAuthTables,
} from "@tests/support/auth-contract";
import type { Db } from "mongodb";
import { Types } from "mongoose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { connectToDatabase } from "@/db/connection";
import { AUTH_EVENT_ACTIONS, AuthEventModel } from "@/modules/audit";
import { recordAuthEvent } from "@/modules/audit/auth-event.service";
import {
  issueSession,
  MAX_FAILED_LOGINS,
  SessionModel,
  UserModel,
} from "@/modules/identity";

/**
 * What happens when the event write is rejected.
 *
 * ADR-0006's write-failure policy, exercised against a real MongoDB validator
 * rather than a mocked model. `collMod` arms a validator on the live collection
 * that rejects every insert, so the write fails the way it would fail in
 * production — a server-side constraint, not a stub throwing on cue. A mock could
 * only prove the code calls the model; this proves the *collection* refuses, which
 * is the failure the policy is written against.
 *
 * Three assertions per case, and all three are needed:
 *
 *  1. the request still produces the response it would have. A successful sign-in
 *     that 500s on its own log is a regression, and it is the reason the policy
 *     is what it is.
 *  2. no row appeared. Absent, not partial.
 *  3. the write was *attempted*. Without this, a suite that stopped calling the
 *     writer entirely would satisfy 1 and 2 while recording nothing at all.
 *
 * The validator is disarmed in `afterEach` and not in `beforeEach`, because
 * `collMod` outlives `deleteMany()` and `syncIndexes()` — a validator left armed
 * fails every other suite in the file, in another file, with an error that points
 * at this one.
 */

let db: Db;

/** Reject every document, whatever it holds. */
const DENY_EVERYTHING = {
  bizNexusRefusesThis: { $exists: true },
};

async function armRefusal(): Promise<void> {
  await db.command({
    collMod: "auth_events",
    validator: DENY_EVERYTHING,
    validationLevel: "strict",
    validationAction: "error",
  });
}

async function disarmRefusal(): Promise<void> {
  await db.command({
    collMod: "auth_events",
    validator: {},
    validationLevel: "off",
  });
}

beforeAll(async () => {
  const mongoose = await connectToDatabase();
  const connected = mongoose.connection.db;
  if (!connected) {
    throw new Error(
      "connectToDatabase() resolved without a `db`. `collMod` below addresses a collection by name, so a suite that cannot reach the handle cannot arm the validator it is about.",
    );
  }
  db = connected;
  // The model has to exist before `collMod` can address its collection. Building
  // the index is the part that creates it, and Mongoose is otherwise lazy about
  // touching a collection a suite has not written to yet.
  await AuthEventModel.syncIndexes();
});

beforeEach(async () => {
  await disarmRefusal();
  await resetAuthTables();
});

afterEach(async () => {
  // Before `restoreAllMocks`, deliberately: an assertion failing below must not
  // leave the collection refusing writes for every suite that runs after this
  // file.
  await disarmRefusal();
  vi.restoreAllMocks();
});

const PASSWORD = "correct horse battery staple";
const UNKNOWN_ADDRESS = "nobody-here@example.invalid";

async function freshUser(): Promise<{ _id: Types.ObjectId; email: string }> {
  const user = await createUser({
    email: `evt-fail-${new Types.ObjectId().toString()}@example.com`,
  });
  return { _id: user._id, email: user.email };
}

/** The one error line the policy allows, parsed back out of what was logged. */
function loggedFailures(spy: ReturnType<typeof vi.spyOn>): unknown[] {
  const out: unknown[] = [];
  for (const call of spy.mock.calls) {
    for (const argument of call) {
      if (typeof argument !== "string") continue;
      if (!argument.includes("auth_event_write_failed")) continue;
      out.push(JSON.parse(argument));
    }
  }
  return out;
}

describe("the armed control", () => {
  it("writes the row when the collection accepts it", async () => {
    const user = await freshUser();

    const response = await login(
      postJson("/login", { email: user.email, password: PASSWORD }),
    );

    // The control every refusal below is measured against. Without it, "no row
    // appeared" would be satisfied by a handler that never writes one.
    expect(response.status).toBe(200);
    expect(await AuthEventModel.countDocuments({ userId: user._id })).toBe(1);
  });
});

describe("a rejected event write on a successful sign-in", () => {
  it("still returns 200 and the session", async () => {
    const user = await freshUser();
    await armRefusal();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await login(
      postJson("/login", { email: user.email, password: PASSWORD }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("bn_session=");
    expect(await AuthEventModel.countDocuments({ userId: user._id })).toBe(0);
    // The write was attempted. Without this the two assertions above would also
    // pass against a handler that had stopped calling the writer.
    expect(loggedFailures(errors)).toHaveLength(1);
  });

  it("emits exactly one error line, carrying the greppable literal", async () => {
    const user = await freshUser();
    await armRefusal();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const infos = vi.spyOn(console, "info").mockImplementation(() => {});
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});

    await login(postJson("/login", { email: user.email, password: PASSWORD }));

    const failures = loggedFailures(errors);
    expect(failures).toHaveLength(1);
    // A fixed literal rather than prose, because detection is a match against a
    // known string — not a semantic search the next edit to a message breaks.
    expect(failures[0]).toMatchObject({ event: "auth_event_write_failed" });
    // Never demoted to a level nobody watches, and not swallowed.
    expect(loggedFailures(infos)).toEqual([]);
    expect(loggedFailures(warns)).toEqual([]);
  });

  it("names the action, the account and the error in that one line", async () => {
    const user = await freshUser();
    await armRefusal();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await login(postJson("/login", { email: user.email, password: PASSWORD }));

    const [failure] = loggedFailures(errors) as Array<Record<string, unknown>>;
    expect(failure).toMatchObject({
      event: "auth_event_write_failed",
      action: AUTH_EVENT_ACTIONS.LOGIN,
      userId: user._id.toString(),
    });
    // The message is what makes the line diagnosable rather than merely present.
    expect(typeof failure.message).toBe("string");
    expect(String(failure.message)).not.toBe("");
    expect(Object.keys(failure).sort()).toEqual([
      "action",
      "event",
      "message",
      "requestId",
      "userId",
    ]);
  });

  it("carries the same requestId as the request that lost the event", async () => {
    const user = await freshUser();
    await armRefusal();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const requestId = "evt-fail-correlation";

    await login(
      postJson(
        "/login",
        { email: user.email, password: PASSWORD },
        { headers: { "x-request-id": requestId } },
      ),
    );

    const [failure] = loggedFailures(errors) as Array<Record<string, unknown>>;
    // The point of the whole mechanism: an operator holding an id a user quoted
    // can determine *definitively* whether that request's event was recorded,
    // which is what turns "absence is ambiguous" into a per-request answer.
    expect(failure.requestId).toBe(requestId);
    // And it is the id the response carries, so the user can quote it.
    expect(failure.requestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("does not resolve to a 500 from anywhere in the handler", async () => {
    const user = await freshUser();
    await armRefusal();

    const response = await login(
      postJson("/login", { email: user.email, password: PASSWORD }),
    );

    // Belt and braces on the status: `withApi` maps an unexpected throw to a
    // 500, so a handler that threw would land here even if the code path looked
    // right. Asserted on the body too, because a 200 carrying an error envelope
    // is the same bug wearing a different hat.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { user: { email: user.email } },
    });
  });
});

describe("a rejected event write on a refused sign-in", () => {
  it("returns a refusal byte-identical to the unarmed path", async () => {
    const user = await freshUser();

    const unarmed = await refusal(
      await login(
        postJson("/login", { email: user.email, password: "not the password" }),
      ),
    );

    // Use a different user for the armed login so the unarmed login's row
    // doesn't pollute the count assertion. The response is identical for any
    // unknown/wrong-password attempt, so the comparison remains valid.
    const armedUser = await freshUser();
    await armRefusal();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const armed = await refusal(
      await login(
        postJson("/login", {
          email: armedUser.email,
          password: "not the password",
        }),
      ),
    );

    // The enumeration defence depends on every refusal looking identical. A
    // failure path that degraded differently when the log was down would turn the
    // event log into an availability oracle: same address, same password, and the
    // body tells you whether the row landed.
    expect(armed).toEqual(unarmed);
    expect(armed.status).toBe(401);
    expect(await AuthEventModel.countDocuments({ userId: armedUser._id })).toBe(
      0,
    );
    expect(loggedFailures(errors)).toHaveLength(1);
  });

  it("still counts the failure towards lockout", async () => {
    // The polarity argument, as an assertion. `recordFailedLogin` runs its `$inc`
    // before the event write exists, and the event write never throws, so an
    // adversary who can make this collection reject writes still cannot stop the
    // counter. Had the event write been placed ahead of the mutation under a
    // throwing policy, account lockout would be off rather than degraded.
    const user = await freshUser();
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { failedLoginCount: MAX_FAILED_LOGINS - 1 } },
    );
    await armRefusal();
    vi.spyOn(console, "error").mockImplementation(() => {});

    await login(
      postJson("/login", { email: user.email, password: "not the password" }),
    );

    const reloaded = await UserModel.findById(user._id).lean();
    expect(reloaded?.failedLoginCount).toBe(MAX_FAILED_LOGINS);
    expect(reloaded?.lockedUntil).toBeInstanceOf(Date);
    // The lockout event was dropped like the others — uniformly, with no
    // per-event branch, and no stricter treatment for the two events an attacker
    // drives.
    expect(await AuthEventModel.countDocuments({})).toBe(0);
  });

  it("still refuses an unknown address, and drops its row", async () => {
    await armRefusal();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await login(
      postJson("/login", { email: UNKNOWN_ADDRESS, password: PASSWORD }),
    );

    expect(response.status).toBe(401);
    expect(
      await AuthEventModel.countDocuments({ email: UNKNOWN_ADDRESS }),
    ).toBe(0);
    const [failure] = loggedFailures(errors) as Array<Record<string, unknown>>;
    // Null, and the line says so rather than omitting the key: an operator
    // reading "no account was named" and one reading "the field was dropped" are
    // different situations.
    expect(failure).toHaveProperty("userId", null);
  });
});

describe("a rejected event write on a handler that needs no account", () => {
  it("drops the logout row and still returns 200", async () => {
    const user = await freshUser();
    const { token } = await issueSession({ userId: user._id });

    await armRefusal();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await logout(authedPost("/logout", {}, token));

    expect(response.status).toBe(200);
    expect(await AuthEventModel.countDocuments({ userId: user._id })).toBe(0);
    // And the session really was revoked. A drop-policy write that skipped the
    // work around it would satisfy both assertions above.
    expect(loggedFailures(errors)).toHaveLength(1);
    expect(
      await SessionModel.countDocuments({ userId: user._id, revokedAt: null }),
    ).toBe(0);
  });
});

describe("the writer itself", () => {
  it("returns null rather than throwing", async () => {
    await armRefusal();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const row = await recordAuthEvent({
      action: AUTH_EVENT_ACTIONS.LOGIN,
      outcome: "success",
      requestId: "evt-fail-direct",
      email: "direct@example.com",
    });

    expect(row).toBeNull();
    expect(loggedFailures(errors)).toHaveLength(1);
  });

  it("reports a caller value that violates a constraint the same way", async () => {
    // A rejected write caused by the caller's own input is the residual hazard
    // ADR-0006 names: it must not become a 500, because on this collection a
    // failed write is swallowed. Reached here by casting, which is what a future
    // refactor that widened `action` to `string` would look like at runtime.
    await armRefusal();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const row = await recordAuthEvent({
      action: "auth.not_a_real_event" as typeof AUTH_EVENT_ACTIONS.LOGIN,
      outcome: "success",
      requestId: "evt-fail-bad-action",
    });

    expect(row).toBeNull();
    expect(loggedFailures(errors)).toHaveLength(1);
  });
});
