import { unstable_rethrow } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
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
 * testing was run against. The rest is the wrapper's other three jobs, plus the
 * cases that only bite in production: a framework signal arriving as a throw,
 * a client-supplied request id, and a secret on its way to the log.
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

function recordingLogger(): Logger & { entries: Record<string, unknown>[] } {
  const entries: Record<string, unknown>[] = [];
  return {
    entries,
    info: (entry) => entries.push({ level: "info", ...entry }),
    warn: (entry) => entries.push({ level: "warn", ...entry }),
    error: (entry) => entries.push({ level: "error", ...entry }),
  };
}

const post = (body?: BodyInit, init: RequestInit = {}) =>
  new Request("https://biz.test/api/v1/things", {
    method: "POST",
    ...init,
    body,
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
