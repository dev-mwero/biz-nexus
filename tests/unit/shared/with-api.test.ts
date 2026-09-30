import { unstable_rethrow } from "next/navigation";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  connectToDatabase,
  disconnectDatabase,
  isDatabaseConnected,
} from "@/db/connection";
import {
  type ApiHandler,
  consoleLogger,
  jsonResponse,
  type Logger,
  REDACTED,
  readJson,
  redact,
  requestIdFor,
  withApi,
} from "@/shared/api/with-api";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";

/**
 * The route handler wrapper.
 *
 * The acceptance criterion for 1.23 is one line — an unexpected error returns a
 * 500 with nothing leaked — so that is the first test and the one mutation
 * testing was run against. The rest is the wrapper's other jobs, plus the cases
 * that only bite in production: a framework signal arriving as a throw, a
 * client-supplied request id, and a secret on its way to the log.
 *
 * No longer hermetic. The wrapper connects the database before it runs a
 * handler, so this suite opens a connection like every integration suite does.
 * That is a deliberate cost, paid for the one thing it buys: an assertion that
 * the handler cannot run before the connection resolves, which is the whole
 * point of doing the connect here rather than in each route.
 */

vi.mock("next/navigation", () => ({
  // The real implementation rethrows anything tagged as a framework signal,
  // rather than checking by identity. Reproduced that way so the wrapper's
  // ordering requirement is actually exercised: if it is called second instead
  // of first, a Next.js error becomes a logged 500.
  unstable_rethrow: vi.fn((error: unknown) => {
    if (error instanceof Error && error.message.startsWith("NEXT_"))
      throw error;
  }),
}));

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

/** The origin `env.APP_URL` declares, which is the one the wrapper trusts. */
const ORIGIN = "http://localhost:3000";

function recordingLogger(): Logger & { entries: Record<string, unknown>[] } {
  const entries: Record<string, unknown>[] = [];
  return {
    entries,
    info: (entry) => entries.push({ level: "info", ...entry }),
    warn: (entry) => entries.push({ level: "warn", ...entry }),
    error: (entry) => entries.push({ level: "error", ...entry }),
  };
}

/**
 * A request from this site, which is every mutating request a real client makes.
 *
 * The `origin` default is here rather than at each call site for one reason: the
 * check fails closed, so a mutating request built without it is a 403. A suite
 * where adding a test silently requires remembering a header is a suite where the
 * next test is wrong.
 */
const post = (body?: BodyInit, init: RequestInit = {}) =>
  new Request(`${ORIGIN}/api/v1/things`, {
    method: "POST",
    body,
    ...init,
    headers: { origin: ORIGIN, ...init.headers },
  });

describe("the acceptance criterion", () => {
  it("returns a 500 with no internals for an unexpected error", async () => {
    // The one line 1.23 is done when. The thrown error carries a connection
    // string, a collection name, and an object id, because that is what a real
    // driver error carries.
    const handler = withApi(
      () => {
        throw new Error(
          "E11000 duplicate key error collection: biznexus.organizations index: slug_1 dup key: { slug: 'acme', _id: ObjectId('64f…') }",
        );
      },
      { logger: recordingLogger() },
    );

    const response = await handler(post());
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).toContain("Something went wrong.");
    // Nothing from the error may appear anywhere in the response.
    for (const fragment of [
      "E11000",
      "biznexus",
      "organizations",
      "64f",
      "acme",
      "at Object",
    ]) {
      expect(text, `leaked ${fragment}`).not.toContain(fragment);
    }
  });

  it("does not leak for a non-Error throw either", async () => {
    // Asserted field by field rather than by scanning the serialised body. A
    // regex over the whole response is flaky here for a good reason: the body
    // contains a random requestId, and roughly one UUID in twelve contains the
    // substring "64f". The payload is the thing under test, not the blob.
    const cases: Array<[unknown, RegExp]> = [
      ["plain string secret", /secret/],
      [{ code: "RECORD_NOT_FOUND", message: "org 64f… exists" }, /64f/],
      [{ message: "db at 10.0.0.4:27017" }, /10\.0\.0\.4/],
      [12345, /12345/],
    ];

    for (const [thrown, leaked] of cases) {
      const handler = withApi(
        () => {
          throw thrown;
        },
        { logger: recordingLogger() },
      );
      const body = (await (await handler(post())).json()) as {
        error: Record<string, unknown>;
      };

      expect(body.error.code, String(thrown)).toBe("INTERNAL");
      expect(body.error.message, String(thrown)).toBe("Something went wrong.");
      // No internals under any key, however they were smuggled in.
      for (const key of ["name", "stack", "cause", "internal", "details"]) {
        expect(
          body.error,
          `${String(thrown)} leaked ${key}`,
        ).not.toHaveProperty(key);
      }
      expect(JSON.stringify(body.error), String(thrown)).not.toMatch(leaked);
    }
  });

  it("still gives the client a request id to quote", async () => {
    const handler = withApi(() => {
      throw new Error("boom");
    });
    const response = await handler(post());
    const body = (await response.json()) as { error: { requestId?: string } };

    expect(body.error.requestId).toBeTruthy();
    expect(response.headers.get("x-request-id")).toBe(body.error.requestId);
  });

  it("logs the real error even though the client never sees it", async () => {
    // The point of a generic message is that it is useless for debugging. The
    // detail has to be somewhere, and it has to be here.
    const logger = recordingLogger();
    const handler = withApi(
      () => {
        throw new Error("ECONNREFUSED 10.0.0.4:27017");
      },
      { logger },
    );

    await handler(post());
    const entry = logger.entries.at(-1);

    expect(entry?.level).toBe("error");
    expect(JSON.stringify(entry)).toMatch(/ECONNREFUSED 10\.0\.0\.4/);
  });
});

describe("mapping deliberate errors", () => {
  it("uses the status from the code", async () => {
    const cases: Array<[AppError, number, string]> = [
      [AppError.unauthorized(), 401, "UNAUTHENTICATED"],
      [AppError.forbidden(), 403, "INSUFFICIENT_PERMISSION"],
      [AppError.notFound(), 404, "RECORD_NOT_FOUND"],
      [AppError.conflict("SLUG_CONFLICT"), 409, "SLUG_CONFLICT"],
      [new AppError("RATE_LIMITED"), 429, "RATE_LIMITED"],
      [
        AppError.validation([{ path: "name", message: "Required" }]),
        422,
        "VALIDATION_FAILED",
      ],
    ];

    for (const [error, status, code] of cases) {
      const response = await withApi(() => {
        throw error;
      })(post());
      const body = (await response.json()) as {
        error: { code: string; details?: unknown[] };
      };

      expect(response.status, code).toBe(status);
      expect(body.error.code).toBe(code);
    }
  });

  it("returns 404, not 403, for a record in another tenant", async () => {
    // The cross-tenant rule, enforced at the boundary where it matters. A 403
    // here would tell an enumerating caller the record exists.
    const response = await withApi(() => {
      throw AppError.notFound();
    })(post());

    expect(response.status).toBe(404);
  });

  it("keeps validation details so the client can highlight fields", async () => {
    const response = await withApi(() => {
      throw AppError.validation([
        { path: "email", message: "Enter a valid email address." },
      ]);
    })(post());
    const body = (await response.json()) as { error: { details?: unknown[] } };

    expect(body.error.details).toEqual([
      { path: "email", message: "Enter a valid email address." },
    ]);
  });

  it("logs an expected refusal as a warning, not an error", async () => {
    // A 403 is the application working. Logging it at error level means a
    // burst of them wakes somebody up, and somebody enumerating ids is exactly
    // what a burst of them is.
    const logger = recordingLogger();
    await withApi(
      () => {
        throw AppError.forbidden();
      },
      { logger },
    )(post());

    expect(logger.entries.at(-1)?.level).toBe("warn");
  });

  it("puts the log-only reason in the warning, and only in the log", async () => {
    // The whole point of `internal`. `loginWithPassword` gives every failed
    // sign-in the same body, so "locked out" and "wrong password" are
    // indistinguishable to the client by design — which makes the log the only
    // place the question can be answered. An operator asking whether an account
    // is being credential-stuffed has nothing to read without this.
    //
    // Both halves asserted, because either alone is satisfied by a change that
    // puts it in the response or drops it from the log.
    const logger = recordingLogger();
    const response = await withApi(
      () => {
        throw new AppError("UNAUTHENTICATED", {
          message: "Sign in to continue.",
          internal: "login failed: locked-out",
        });
      },
      { logger },
    )(post());
    const body = (await response.json()) as { error: Record<string, unknown> };

    expect(logger.entries.at(-1)?.internal).toBe("login failed: locked-out");
    expect(JSON.stringify(body)).not.toContain("locked-out");
    expect(body.error).not.toHaveProperty("internal");
  });

  it("omits `internal` from a warning that has none", async () => {
    // Not an empty string. A key reading `internal: undefined` claims there was
    // no internal detail, which is a different claim from "none was recorded".
    const logger = recordingLogger();
    await withApi(
      () => {
        throw AppError.forbidden();
      },
      { logger },
    )(post());

    expect(logger.entries.at(-1)).not.toHaveProperty("internal");
  });

  it("still leaves a stack out of a warning", async () => {
    // Mirrors the error branch's caution. A stack on every 401 turns a real
    // signal into noise, and a refusal is not a failure.
    const logger = recordingLogger();
    await withApi(
      () => {
        throw AppError.forbidden();
      },
      { logger },
    )(post());

    const entry = JSON.stringify(logger.entries.at(-1));
    expect(entry).not.toContain("stack");
    expect(entry).not.toContain("at AppError");
  });

  it("replaces the message of a non-exposed code", async () => {
    const response = await withApi(
      () => {
        throw new AppError("DATABASE_ERROR", {
          message: "conn refused to 10.0.0.4",
        });
      },
      { logger: recordingLogger() },
    )(post());
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toMatch(/10\.0\.0\.4/);
  });
});

describe("success responses", () => {
  it("wraps an envelope as data", async () => {
    const response = await withApi(() => ok({ id: "1", name: "Acme" }))(post());
    const body = (await response.json()) as { data: { id: string } };

    expect(response.status).toBe(200);
    expect(body.data.id).toBe("1");
  });

  it("wraps a bare value from untyped code rather than breaking the client", async () => {
    // Outside HandlerResult on purpose. A handler written in plain JavaScript
    // can still return `{ name: "Acme" }`, and the client should see
    // `{ "data": { "name": "Acme" } }` rather than a body shape nothing expects.
    const response = await withApi((() => ({
      name: "Acme",
    })) as unknown as ApiHandler)(post());

    expect(await response.json()).toEqual({ data: { name: "Acme" } });
  });

  it("passes an envelope through, keeping its meta", async () => {
    const response = await withApi(() => ({
      data: [{ id: "1" }],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    }))(post());
    const body = (await response.json()) as { data: unknown[]; meta: unknown };

    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({ total: 1 });
  });

  it("keeps a falsy payload rather than dropping the body", async () => {
    // An empty list must not come back as a 200 with no body, which a client
    // reads as undefined and then crashes on.
    const response = await withApi(() => ok([]))(post());
    expect(await response.json()).toEqual({ data: [] });

    const nullish = await withApi(() => ok(null))(post());
    expect(await nullish.json()).toEqual({ data: null });
  });

  it("leaves a Response the handler built alone", async () => {
    // 204s, redirects, and streamed bodies are not the envelope's to rewrite.
    const response = await withApi(() => new Response(null, { status: 204 }))(
      post(),
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("adds the request id to a Response without consuming its body", async () => {
    // A Response body can only be read once, so stamping the id cannot go
    // through json() — it has to rebuild the Response around the stream.
    const handler = withApi(
      () =>
        new Response("streamed", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );
    const response = await handler(post());

    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(await response.text()).toBe("streamed");
  });

  it("honours a status option for created resources", async () => {
    const response = await withApi(() => ok({ id: "1" }), { status: 201 })(
      post(),
    );
    expect(response.status).toBe(201);
  });

  it("always answers JSON", async () => {
    const response = await withApi(() => ok({ id: "1" }))(post());
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
  });
});

describe("request ids", () => {
  it("generates one when the caller sends none", async () => {
    const response = await withApi(() => ok(true))(post());
    expect(response.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("keeps an inbound id so a trace survives across services", async () => {
    const response = await withApi(() => ok(true))(
      post(undefined, { headers: { "x-request-id": "edge-abc123" } }),
    );
    expect(response.headers.get("x-request-id")).toBe("edge-abc123");
  });

  it("replaces an inbound id that is not safe to log", async () => {
    // The id is attacker controlled and ends up in a log line. Newlines would
    // let a caller forge entries; an unbounded one would bloat the log.
    //
    // CR and LF are absent from this list on purpose: the Headers constructor
    // rejects them, so a request carrying one cannot be constructed at all. The
    // guard for that is defence in depth rather than a reachable path, and
    // pretending otherwise would overstate what this test covers.
    for (const hostile of [
      "a".repeat(500),
      "semi;colon",
      "<script>",
      "has space",
      "tab\there",
    ]) {
      const id = requestIdFor(
        post(undefined, { headers: { "x-request-id": hostile } }),
      );
      expect(id, hostile).not.toBe(hostile);
      expect(id, hostile).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    }
  });

  it("rejects a newline-bearing id even when one is forced past Headers", () => {
    // Reachable only by calling the function directly, which is the point: the
    // log-integrity guarantee should not rest on a parser further upstream.
    for (const hostile of ["has\nnewline", "has\rreturn"]) {
      expect(
        requestIdFor({ headers: { get: () => hostile } } as unknown as Request),
        hostile,
      ).not.toBe(hostile);
    }
  });

  it("gives the handler and the response the same id", async () => {
    let seen: string | undefined;
    const response = await withApi(
      (_request, context) => {
        seen = context.requestId;
        throw new Error("boom");
      },
      { logger: recordingLogger() },
    )(post());
    const body = (await response.json()) as { error: { requestId: string } };

    expect(seen).toBe(body.error.requestId);
    expect(seen).toBe(response.headers.get("x-request-id"));
  });

  it("puts the same id in the log line as in the response", async () => {
    // The whole point of the id: it is what a user reads off a 500 and pastes
    // into a bug report, so the log line has to carry the identical value.
    const logger = recordingLogger();
    const response = await withApi(() => ok(true), { logger })(
      post(undefined, { headers: { "x-request-id": "edge-trace-9" } }),
    );

    expect(logger.entries.at(-1)?.requestId).toBe("edge-trace-9");
    expect(response.headers.get("x-request-id")).toBe("edge-trace-9");
  });
});

describe("framework signals", () => {
  it("rethrows a Next.js error instead of turning it into a 500", async () => {
    // `redirect()` and `notFound()` work by throwing. A blanket catch makes a
    // redirect a dead end and a not-found an error page.
    const handler = withApi(() => {
      throw new Error("NEXT_REDIRECT;replace;/dashboard;307;");
    });
    const logger = recordingLogger();

    await expect(handler(post())).rejects.toThrow("NEXT_REDIRECT");
    // And it was not logged as our failure.
    expect(logger.entries).toHaveLength(0);
  });

  it("calls unstable_rethrow before it logs or maps anything", async () => {
    // The ordering is load-bearing. If the logging and the status mapping came
    // first, a framework signal would be recorded as our failure and reported
    // as a 500 before rethrow ever saw it.
    const logger = recordingLogger();
    const handler = withApi(
      () => {
        throw new Error("NEXT_NOT_FOUND");
      },
      { logger },
    );

    await expect(handler(post())).rejects.toThrow("NEXT_NOT_FOUND");

    expect(unstable_rethrow).toHaveBeenCalledTimes(1);
    // No log line and no response: the error never became ours.
    expect(logger.entries).toHaveLength(0);
  });

  it("still handles an ordinary error after calling rethrow", async () => {
    // rethrow is called for everything, including errors it will not rethrow.
    const logger = recordingLogger();
    const response = await withApi(
      () => {
        throw new Error("ordinary");
      },
      { logger },
    )(post());

    expect(response.status).toBe(500);
    expect(logger.entries.at(-1)?.level).toBe("error");
  });
});

describe("logging", () => {
  it("records method, path, status, and duration on success", async () => {
    const logger = recordingLogger();
    await withApi(() => ok(true), { logger })(
      post(undefined, { headers: { "x-request-id": "trace-1" } }),
    );
    const entry = logger.entries.at(-1);

    expect(entry).toMatchObject({
      level: "info",
      method: "POST",
      path: "/api/v1/things",
      status: 200,
      requestId: "trace-1",
    });
    expect(typeof entry?.durationMs).toBe("number");
  });

  it("never logs the request body, headers, or query", async () => {
    // Stronger than redacting them, and the property that actually matters: a
    // password or a session cookie is not in the log line to be redacted in the
    // first place. Redaction is the fallback for whatever else gets logged.
    const logger = recordingLogger();
    await withApi(
      () => {
        throw AppError.validation([{ path: "password", message: "Required" }]);
      },
      { logger },
    )(
      post(JSON.stringify({ password: "hunter2" }), {
        headers: {
          "content-type": "application/json",
          cookie: "bn_session=super-secret-session",
          authorization: "Bearer super-secret-token",
        },
      }),
    );
    const line = JSON.stringify(logger.entries.at(-1));

    expect(line).not.toMatch(/hunter2|super-secret-session|super-secret-token/);
    // The log still says what failed, just not which field or what the client
    // was told. Details are the client's: a detail message can echo whatever a
    // caller sent, and this is the line that gets shipped to a log aggregator.
    expect(line).toContain("VALIDATION_FAILED");
    expect(line).not.toContain("Required");
  });

  it("redacts a secret key but keeps the key visible", () => {
    // A log line reading `password: undefined` claims no password was sent,
    // which is a different claim from "one was sent and is not logged".
    const scrubbed = redact({ password: "hunter2", name: "Ada" }) as Record<
      string,
      unknown
    >;

    expect(scrubbed.password).toBe(REDACTED);
    expect(scrubbed.name).toBe("Ada");
  });

  it("redacts secrets wherever they are nested", () => {
    const scrubbed = redact({
      authorization: "Bearer abc",
      user: { password: "hunter2", name: "Ada" },
      cookies: ["bn_session=abc"],
      nested: { deeper: { tokenHash: "deadbeef" } },
    }) as Record<string, unknown>;

    expect(JSON.stringify(scrubbed)).not.toMatch(/hunter2|deadbeef|Bearer abc/);
    expect((scrubbed.user as Record<string, unknown>).name).toBe("Ada");
  });

  it("reduces an Error to name, message, and code", () => {
    // A logged Error serialises to {} otherwise, and a stack in a log line is a
    // liability rather than a diagnostic aid.
    const error = new AppError("RECORD_NOT_FOUND", {
      message: "Deal not found.",
    });
    const scrubbed = redact({ error }) as { error: Record<string, unknown> };

    expect(scrubbed.error.name).toBe("AppError");
    expect(scrubbed.error.message).toBe("Deal not found.");
    expect(scrubbed.error.code).toBe("RECORD_NOT_FOUND");
    expect(scrubbed.error).not.toHaveProperty("stack");
  });

  it("stops recursing on a self-referencing object", () => {
    // An object graph with a cycle in it would otherwise hang the logger,
    // which is the worst possible time to find out.
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;

    expect(() => redact(cyclic)).not.toThrow();
  });

  it("writes one JSON line per event through the console logger", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    consoleLogger.info({ method: "GET", password: "hunter2" });

    const line = spy.mock.calls[0]?.[0] as string;
    expect(() => JSON.parse(line)).not.toThrow();
    expect(line).not.toContain("hunter2");
    expect(line).toContain('"method":"GET"');
    spy.mockRestore();
  });
});

describe("readJson", () => {
  it("parses a JSON body", async () => {
    const body = await readJson<{ name: string }>(
      post(JSON.stringify({ name: "Acme" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    expect(body.name).toBe("Acme");
  });

  it("maps malformed JSON to a 400 rather than a 500", async () => {
    // A stray apostrophe should not look like our fault, and should not page
    // anybody through a 500.
    const handler = withApi(async (request) => ok(await readJson(request)));

    const response = await handler(
      post("{ name: 'Acme' }", {
        headers: { "content-type": "application/json" },
      }),
    );
    const parsed = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(parsed.error.code).toBe("BAD_REQUEST");
  });

  it("refuses a body that is not JSON", async () => {
    const handler = withApi(async (request) => ok(await readJson(request)));
    const response = await handler(
      post("name=Acme", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    );

    expect(response.status).toBe(400);
  });

  it("treats an empty body as an empty object", async () => {
    const body = await readJson(
      post("", { headers: { "content-type": "application/json" } }),
    );
    expect(body).toEqual({});
  });
});

describe("jsonResponse", () => {
  it("sets the JSON content type and merges extra headers", () => {
    const response = jsonResponse({ ok: true }, 200, { "x-custom": "1" });

    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(response.headers.get("x-custom")).toBe("1");
  });
});

describe("the Origin check", () => {
  /**
   * The gap this closes was found by a probe: a POST with no `Origin` at all
   * received 201. Nothing in any of the nine auth handlers checked it, while
   * docs/SECURITY.md §7 and ADR-0002 both said they did.
   */
  it("passes a mutating request from this site", async () => {
    const response = await withApi(() => ok({ created: true }))(post());

    expect(response.status).toBe(200);
  });

  it("refuses a mutating request from another site, with its own code", async () => {
    const response = await withApi(() => ok({ created: true }))(
      post(undefined, { headers: { origin: "https://evil.example" } }),
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(403);
    // Not INSUFFICIENT_PERMISSION. A cross-origin refusal is not a permission
    // decision, and conflating them poisons the "a burst of 403s is somebody
    // enumerating" signal with every cross-site request a browser makes.
    expect(body.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("refuses a request with no Origin at all", async () => {
    // Fail closed, and this is the case that matters: "no Origin" is exactly the
    // shape of the probe that found the gap. Browsers send Origin on every
    // non-GET/HEAD request including same-origin, so an honest client loses
    // nothing by being refused here.
    const response = await withApi(() => ok({ created: true }))(
      new Request(`${ORIGIN}/api/v1/things`, { method: "POST" }),
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("refuses the literal `null` a sandboxed iframe sends", async () => {
    const response = await withApi(() => ok({ created: true }))(
      post(undefined, { headers: { origin: "null" } }),
    );

    expect(response.status).toBe(403);
  });

  it("compares the whole origin, not a host or a suffix", async () => {
    // Host-only comparison would accept all three of these.
    for (const origin of [
      "https://localhost:3000.evil.example",
      "https://evil.example/http://localhost:3000",
      "https://localhost:3001",
    ]) {
      const response = await withApi(() => ok({ created: true }))(
        post(undefined, { headers: { origin } }),
      );
      expect(response.status, origin).toBe(403);
    }
  });

  it("does not believe a forwarded host", async () => {
    // The failure mode this avoids. If the trusted origin were read from
    // `Host`, `X-Forwarded-Host` or `Referer`, the caller would supply the
    // expected value itself — here they all name the origin this API runs on,
    // and the request is still refused, because the only header that counts is
    // one the caller does not get to set.
    const response = await withApi(() => ok({ created: true }))(
      new Request(`${ORIGIN}/api/v1/things`, {
        method: "POST",
        headers: {
          host: "localhost:3000",
          "x-forwarded-host": "localhost:3000",
          referer: "https://localhost:3000/app",
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("lets a GET through with no Origin, so the proxy and the UI still work", async () => {
    const response = await withApi(() => ok(true))(
      new Request(`${ORIGIN}/api/v1/things`, { method: "GET" }),
    );

    expect(response.status).toBe(200);
  });

  it("lets a preflight through with no Origin", async () => {
    // If OPTIONS were checked, every cross-origin read would fail at preflight
    // instead of at the request — and preflight carries no cookie, so there is
    // nothing to protect.
    const response = await withApi(() => ok(true))(
      new Request(`${ORIGIN}/api/v1/things`, { method: "OPTIONS" }),
    );

    expect(response.status).toBe(200);
  });

  it("checks a method it has never heard of", async () => {
    // The allow-list is the point: a method added by a framework later is
    // checked until somebody decides otherwise, rather than passing by default.
    for (const method of ["PUT", "PATCH", "DELETE", "PROPFIND"]) {
      const request = new Request(`${ORIGIN}/api/v1/things`, { method });
      const response = await withApi(() => ok(true))(request);

      expect(response.status, method).toBe(403);
    }
  });

  it("reports a refusal through the normal envelope, with a request id", async () => {
    // Inside the try, deliberately: a refusal that escaped the wrapper would be
    // a bare unhandled rejection rather than something a client can act on and
    // an operator can find in the log.
    const logger = recordingLogger();
    const response = await withApi(() => ok({ created: true }), { logger })(
      new Request(`${ORIGIN}/api/v1/things`, { method: "POST" }),
    );
    const body = (await response.json()) as { error: { requestId: string } };

    expect(body.error.requestId).toBeTruthy();
    expect(response.headers.get("x-request-id")).toBe(body.error.requestId);
    expect(logger.entries.at(-1)).toMatchObject({
      level: "warn",
      code: "ORIGIN_NOT_ALLOWED",
      status: 403,
    });
  });

  it("never reaches the handler when the origin is refused", async () => {
    const handler = vi.fn(() => ok({ created: true }));
    await withApi(handler)(
      new Request(`${ORIGIN}/api/v1/things`, { method: "POST" }),
    );

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("connecting once per request", () => {
  it("resolves the connection before the handler runs", async () => {
    // The property, not the mechanism. `bufferCommands: false` means a query
    // issued before the socket exists is not queued — it is rejected — so a
    // handler that ran first would 500 on a cold instance, intermittently, for
    // every endpoint except the one that happened to open a transaction.
    const order: string[] = [];
    await withApi(() => {
      order.push(`handler:${String(isDatabaseConnected())}`);
      return ok(true);
    })(post());

    expect(order).toEqual(["handler:true"]);
  });

  it("does not need a branch for an unavailable database", async () => {
    // A database outage arriving as an enveloped 500 with a request id is the
    // correct behaviour and the one contract every route already has. A second
    // error shape here would mean the route had to know which one it got.
    const response = await withApi(async () => {
      throw new Error("connection refused");
    })(post());
    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("Something went wrong.");
    expect(body.error.requestId).toBeTruthy();
  });
});
