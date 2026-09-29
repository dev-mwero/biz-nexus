import { randomUUID } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import {
  AppError,
  type FieldDetail,
  isAppError,
  toErrorPayload,
  toErrorStatus,
} from "@/shared/errors/app-error";
import { fail, ok, type ResponseMeta } from "@/shared/responses/envelope";

/**
 * The route handler wrapper.
 *
 * Every route gets the same four things it would otherwise reimplement badly:
 * a request id to quote in a bug report, errors mapped from codes to statuses,
 * a log line per request, and a guarantee that nothing unexpected reaches the
 * client. The last one is the point of the module. A route that forgets its
 * error handling should degrade to a generic 500, not to a leaked stack trace,
 * and forgetting has to be the *default* for that to hold.
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

/** Anything the logger is handed that might hold a secret gets scrubbed. */
const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "newpassword",
  "currentpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "tokenhash",
  "secret",
  "apikey",
  "csrftoken",
]);

export const REDACTED = "[redacted]";

/**
 * Replace secret-bearing values rather than dropping their keys.
 *
 * Keeping the key matters: a log line that says `password: undefined` reads
 * like "no password was sent", which is a different claim from "a password was
 * sent and is not logged", and only the second is true.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(typeof (value as AppError).code === "string"
        ? { code: (value as AppError).code }
        : {}),
    };
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase())
        ? REDACTED
        : redact(inner, depth + 1);
    }
    return out;
  }
  return value;
}

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
 * Wrap a route handler.
 *
 * `unstable_rethrow` runs first in the catch, before anything else. Next.js
 * signals `redirect()`, `notFound()`, and dynamic-IO violations by throwing, and
 * a blanket catch turns all of them into a 500 — a redirect that becomes a dead
 * end, and a cache-control signal that becomes an error page. The docs are
 * explicit that it belongs at the top of the block, before cleanup, and that
 * ordering is load-bearing: cleanup after it would run against a request Next.js
 * is still using.
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

      if (isAppError(error) && error.expose) {
        // A deliberate, client-facing refusal. Logged as a warning because it
        // is the application working, not the application failing — but worth
        // seeing, since a burst of 403s is somebody enumerating ids.
        logger.warn({
          ...context,
          status,
          code: error.code,
          message: error.message,
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
