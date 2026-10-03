import { randomUUID } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import { connectToDatabase } from "@/db/connection";
import { env } from "@/env";
import {
  AppError,
  type FieldDetail,
  isAppError,
  toAppError,
  toErrorPayload,
  toErrorStatus,
} from "@/shared/errors/app-error";
import { fail, ok, type ResponseMeta } from "@/shared/responses/envelope";

/**
 * The route handler wrapper.
 *
 * Every route gets the same things it would otherwise reimplement badly: a
 * request id to quote in a bug report, an origin check on mutating requests, a
 * connected database, errors mapped from codes to statuses, a log line per
 * request, and a guarantee that nothing unexpected reaches the client. The last
 * one is the point of the module. A route that forgets its error handling should
 * degrade to a generic 500, not to a leaked stack trace, and forgetting has to
 * be the *default* for that to hold.
 */

export interface ApiContext {
  /** Stable for the life of the request. In every response and every log line. */
  requestId: string;
  method: string;
  path: string;
}

export interface Logger {
  info(entry: Record<string, unknown>): void;
  warn(entry: Record<string, unknown>): void;
  error(entry: Record<string, unknown>): void;
}

// Anything the logger is handed that might hold a secret gets scrubbed, by the
// same code that scrubs audit rows - so what is redacted from logs and what is
// redacted from permanent records cannot drift apart.
//
// Re-exported so the route wrapper keeps one obvious import, and so there is
// exactly one definition of what counts as a secret.
import { isSensitiveKey, REDACTED, redact } from "@/shared/lib/redact";

export { isSensitiveKey, REDACTED, redact };

/**
 * A single-line JSON logger.
 *
 * One line per event so a log aggregator can index it, and never a stack
 * trace: the message and code are what get correlated, and a full trace in
 * production logs is a liability rather than a diagnostic aid.
 */
export const consoleLogger: Logger = {
  info: (entry) => console.info(JSON.stringify(redact(entry))),
  warn: (entry) => console.warn(JSON.stringify(redact(entry))),
  error: (entry) => console.error(JSON.stringify(redact(entry))),
};

const REQUEST_ID_HEADER = "x-request-id";

/**
 * An inbound request id is honoured only if it is safe to put in a log line.
 *
 * The id is attacker controlled, so the two things that matter are the charset
 * — no CR, LF, or angle brackets, or a caller can forge or break log lines — and
 * the length cap, or a caller can bloat the log. Honouring it across services is
 * the whole point, so the pattern is not a UUID check; it is "something we might
 * have generated ourselves".
 *
 * The `Headers` constructor already rejects a value containing CR or LF, so the
 * charset half is unreachable through a real request. It stays because this
 * function is also handed ids from other sources, and because a log-integrity
 * guarantee should not depend on a parser three layers down.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requestIdFor(request: Request): string {
  const inbound = request.headers.get(REQUEST_ID_HEADER);
  if (inbound && SAFE_REQUEST_ID.test(inbound)) return inbound;
  return randomUUID();
}

export function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/**
 * Read and parse a JSON body, mapping unreadable input to a 400.
 *
 * Without this, malformed JSON surfaces as a `SyntaxError` from `Request.json`
 * and becomes a 500, which tells the caller their request was our fault and
 * burns an alert on every stray apostrophe. The distinction between "your JSON
 * is broken" and "we broke" is worth five lines.
 */
export async function readJson<T = unknown>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new AppError("BAD_REQUEST", {
      message: "Expected a JSON request body.",
    });
  }

  const text = await request.text();
  if (text.trim() === "") return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new AppError("BAD_REQUEST", {
      message: "The request body is not valid JSON.",
      cause,
      internal: "JSON.parse failed on the request body",
    });
  }
}

/**
 * What a handler may return: an envelope, a Response it built itself, or
 * nothing.
 *
 * Bare data is deliberately not in the union even though the runtime tolerates
 * it. Allowing both would make "does this returned object have a `data` key?"
 * ambiguous — a handler legitimately returning `{ data: "…" }` as its payload
 * would be read as an envelope and double-wrapped. Requiring `ok()` costs five
 * characters at each call site and removes the question entirely.
 */
export type HandlerResult =
  | Response
  | { data: unknown; meta?: ResponseMeta }
  | undefined;

export type ApiHandler = (
  request: Request,
  context: ApiContext,
) => HandlerResult | Promise<HandlerResult>;

export interface WithApiOptions {
  logger?: Logger;
  /** Status for a successful return. Ignored when the handler returns a Response. */
  status?: number;
  headers?: Record<string, string>;
}

/**
 * Methods that skip the Origin check.
 *
 * An allow-list, not a denylist of mutating methods. `{GET, HEAD, OPTIONS}` in
 * one place means a method added later — and every framework adds methods
 * eventually — is checked until somebody deliberately decides otherwise. The
 * denylist form is the one that fails open the day it is extended.
 *
 * `OPTIONS` is exempt because a preflight carries no cookie and must still be
 * answerable; if it were checked, every cross-origin read would fail at
 * preflight instead of at the request.
 */
const ORIGIN_EXEMPT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The one origin this API answers to.
 *
 * `env.APP_URL`, and never `Host`, `X-Forwarded-Host` or `Referer`. All three of
 * those are request headers, and a header is a value the caller chooses: in any
 * deployment not sitting behind a trusted proxy that overwrites them, the
 * "expected" origin would be supplied by the party being checked, which is not a
 * check. `APP_URL` is already validated, already forced to https in production,
 * and settable per environment, so a preview deployment checks itself.
 *
 * Compared whole rather than by host or by suffix, so `https://app.example.com`
 * does not accept `https://app.example.com.evil.test`.
 */
const TRUSTED_ORIGIN = new URL(env.APP_URL).origin;

/**
 * Refuse a mutating request that did not come from this site.
 *
 * `SameSite=Lax` is not enough, and the reasons are worth writing down because
 * each one is a way this check is skipped:
 *
 *   - SameSite is a browser policy with no server-side enforcement. Nothing
 *     stops a non-browser client from sending the request.
 *   - Same-site is not same-origin. A POST from `evil.vercel.app` to
 *     `yourapp.vercel.app` is same-site, so the cookie rides along.
 *   - An open redirect on this origin converts a cross-site request into a
 *     same-site one before it reaches here.
 *   - Lax is blind to state-changing GETs.
 *
 * Fails closed on a missing `Origin` and on the literal `"null"` a sandboxed
 * iframe sends. Next.js's own Server Actions check is more lenient — it allows a
 * missing Origin through with a warning — and that leniency is not copied here,
 * because "no Origin" is precisely the shape of the probe that found this gap.
 * Real cost: browsers send `Origin` on every non-GET/HEAD request, same-origin
 * included, so every honest client already sends it.
 */
function assertSameOrigin(request: Request): void {
  if (ORIGIN_EXEMPT_METHODS.has(request.method)) return;

  const origin = request.headers.get("origin");
  if (origin !== TRUSTED_ORIGIN) {
    throw new AppError("ORIGIN_NOT_ALLOWED");
  }
}

/**
 * Wrap a route handler.
 *
 * `unstable_rethrow` runs first in the catch, before anything else. Next.js
 * signals `redirect()`, `notFound()`, and dynamic-IO violations by throwing, and
 * a blanket catch turns all of them into a 500 — a redirect that becomes a dead
 * end, and a cache-control signal that becomes an error page. The docs are
 * explicit that it belongs at the top of the block, before cleanup, and that
 * ordering is load-bearing: cleanup after it would run against a request Next.js
 * is still using.
 *
 * The body order is load-bearing in the same way. The origin check runs before
 * the connection is opened, and the connection is resolved before the handler
 * runs, so a handler can never observe a request from the wrong origin and never
 * has to remember to wait for the database. `connectToDatabase` returns the
 * instance's cached promise, so after the first request this is an await on an
 * already-resolved promise.
 *
 * There is deliberately no branch for "the database is not available". A
 * database outage has to arrive as an enveloped 500 through the normal path —
 * a different answer here would be a second error contract, and the route would
 * have to know which one it got.
 */
export function withApi(
  handler: ApiHandler,
  options: WithApiOptions = {},
): (request: Request) => Promise<Response> {
  const logger = options.logger ?? consoleLogger;

  return async (request: Request): Promise<Response> => {
    const requestId = requestIdFor(request);
    const context: ApiContext = {
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
    };
    const startedAt = performance.now();

    try {
      // Both of these are per-request, and both are here so that forgetting is
      // the default rather than the exception. The origin check is first because
      // refusing a request that should never have arrived is cheaper than
      // opening a socket for it.
      assertSameOrigin(request);
      await connectToDatabase();

      const result = await handler(request, context);

      // A handler that built its own Response keeps it: 204s, redirects, and
      // streamed bodies are not something the envelope should overwrite.
      if (result instanceof Response) {
        logger.info({
          ...context,
          status: result.status,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return withRequestId(result, requestId);
      }

      // Unreachable from typed code, and deliberately so: see HandlerResult.
      // Kept as a net so a handler returning bare data from untyped JavaScript
      // gets a well-formed envelope rather than a client that chokes on it.
      const body =
        result && typeof result === "object" && "data" in result
          ? result
          : ok(result);

      logger.info({
        ...context,
        status: options.status ?? 200,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return jsonResponse(body, options.status ?? 200, {
        ...options.headers,
        [REQUEST_ID_HEADER]: requestId,
      });
    } catch (error) {
      // Must be the first statement. See above.
      unstable_rethrow(error);

      const status = toErrorStatus(error);
      const payload = toErrorPayload(error);
      // The mapped error, not the thrown one. Asking `isAppError(error)` instead
      // would send every failure a library raised down the error branch below —
      // a `ZodError` from a route's own schema, a `CastError` from a write
      // carrying the value that would not cast, a `ValidationError` carrying
      // the value the schema refused. Those are all the client working, so they
      // belong in this branch with the refusals: a warning, no stack, and
      // nothing in the line that came out of the request.
      const mapped = toAppError(error);

      if (mapped?.expose) {
        // A deliberate, client-facing refusal. Logged as a warning because it
        // is the application working, not the application failing — but worth
        // seeing, since a burst of 403s is somebody enumerating ids.
        //
        // `internal` is included because a refusal with a log-only reason is
        // only half a record. `loginWithPassword` puts "locked out" versus
        // "wrong password" there precisely so the client cannot tell them apart,
        // which leaves the log as the only place that question is answerable —
        // and an operator asking "is this account being credential-stuffed, and
        // is it now locked?" has nothing to read.
        //
        // No stack and no `cause` here, unlike the branch below. A stack per 401
        // turns a real signal into noise, and a refusal is not a failure. That
        // reasoning is why this branch is now also where a mistyped value lands:
        // one bad field from a client is a refusal, and a stack for each is how
        // a typo becomes a page.
        logger.warn({
          ...context,
          status,
          code: mapped.code,
          message: mapped.message,
          ...(mapped.internal ? { internal: mapped.internal } : {}),
          durationMs: Math.round(performance.now() - startedAt),
        });
      } else {
        // The only place the real error is recorded. Everything the client sees
        // from here on is the generic payload below.
        logger.error({
          ...context,
          status,
          code: payload.code,
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack
            ? { stack: error.stack }
            : {}),
          ...(isAppError(error) && error.internal
            ? { internal: error.internal }
            : {}),
          cause: error,
          durationMs: Math.round(performance.now() - startedAt),
        });
      }

      return jsonResponse(fail(error, requestId), status, {
        [REQUEST_ID_HEADER]: requestId,
      });
    }
  };
}

/**
 * Copy the request id onto a Response the handler built, without consuming its
 * body. A Response body can only be read once, so this cannot go through
 * `json()` and must not try.
 */
function withRequestId(response: Response, requestId: string): Response {
  if (response.headers.get(REQUEST_ID_HEADER) === requestId) return response;

  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export type { FieldDetail };
