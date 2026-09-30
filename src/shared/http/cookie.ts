import { env } from "@/env";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * Cookie serialisation.
 *
 * The session cookie is the whole authentication boundary, so every attribute
 * here is load-bearing and none of them is a default worth changing casually:
 *
 * - `HttpOnly`, because the value is a bearer credential. A cookie readable from
 *   JavaScript is a cookie that any XSS on the site can steal, and the stolen
 *   value works from anywhere.
 * - `SameSite=Lax`, which still sends the cookie on a top-level GET from another
 *   site, so shared links keep working, while withholding it from cross-site
 *   POSTs. `Strict` would be stronger and would break the emailed invitation and
 *   password-reset links, which are exactly the flows this system depends on.
 *   This is the reason CSRF tokens are not on the critical path for these
 *   endpoints rather than an oversight.
 * - `Secure` outside development, so the value never crosses plaintext HTTP.
 *   Left on in production where a proxy terminates TLS, and off in development
 *   where there is no certificate and a Secure cookie is silently dropped by
 *   every browser - which presents as "the sign-in form does nothing".
 * - `Path=/`, because the session is read by the proxy on every route, not just
 *   under a prefix.
 *
 * `Max-Age` rather than `Expires`: it is relative, so it does not depend on the
 * client clock being right, and a device with a badly wrong clock cannot end up
 * with a cookie that outlives the server's revocation.
 */

export interface CookieOptions {
  maxAgeSeconds?: number;
  path?: string;
  sameSite?: "Strict" | "Lax" | "None";
  httpOnly?: boolean;
}

/**
 * Whether cookies should carry `Secure` in this environment.
 *
 * Reads the validated `env.NODE_ENV` rather than `process.env`, so there is no
 * unvalidated copy of the one variable that decides the answer. That makes this
 * module transitively dependent on `@/env`'s module-load validation, which is a
 * real coupling: a unit test of this file needs a bootable environment.
 *
 * The predicate is an allow-list of the two environments that are genuinely
 * local, and it must stay that way. `=== "production"` reads more naturally and
 * fails in the dangerous direction: a future `staging` or `preview` value would
 * not match, and the cookie would go out without `Secure`.
 *
 * The parameter exists for the tests and defaults to the process's own
 * environment. It is deliberately *not* named `env` — that would shadow the
 * import and throw a TDZ ReferenceError at call time, in a cookie helper.
 */
export function shouldUseSecureCookies(
  nodeEnv: string = env.NODE_ENV,
): boolean {
  return nodeEnv !== "development" && nodeEnv !== "test";
}

function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  parts.push(`Path=${options.path ?? "/"}`);

  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  }

  if (options.httpOnly ?? true) parts.push("HttpOnly");
  if (options.sameSite ?? "Lax")
    parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  // Not an option, deliberately. `options.secure ?? shouldUseSecureCookies()`
  // looks harmless and is not: it lets any call site force `Secure` off in
  // production, and a policy a call site can defeat is not a policy. No caller
  // passes it today; that is the reason it can be removed rather than deprecated.
  if (shouldUseSecureCookies()) parts.push("Secure");

  return parts.join("; ");
}

/** The `Set-Cookie` value that plants or refreshes the session. */
export function sessionCookie(
  token: string,
  maxAgeSeconds: number,
  options: CookieOptions = {},
): string {
  return serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds, ...options });
}

/**
 * The `Set-Cookie` value that removes it.
 *
 * The attributes must match the ones it was set with, or the browser keeps the
 * original: a cookie is identified by name, domain and path, and a mismatch on
 * `Path` makes the delete a no-op that looks like a sign-out bug. `Max-Age=0` is
 * what actually expires it; sending an empty value as well is belt and braces
 * for clients that treat an empty value oddly.
 */
export function clearSessionCookie(options: CookieOptions = {}): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, ...options });
}

/**
 * Read one cookie from a request.
 *
 * Returns null for a missing cookie rather than throwing, because a request
 * without a session is the normal unauthenticated case, not an error. Decoded
 * with `decodeURIComponent`, guarded because a malformed percent-escape in a
 * header should read as "no cookie" and not take down the request.
 */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;

    if (part.slice(0, separator).trim() !== name) continue;

    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }

  return null;
}
