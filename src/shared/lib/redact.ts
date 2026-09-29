import type { AppError } from "@/shared/errors/app-error";

/**
 * Redaction of secret-bearing values.
 *
 * Lives here rather than in the route wrapper because two unrelated things need
 * it, and the second is the more unforgiving of the two. A log line is
 * aggregated, sampled and shipped somewhere else; an audit-log row is
 * append-only, so nothing written into one can ever be taken back. A password
 * hash in an audit row is a credential at rest, permanently, in a collection
 * whose whole purpose is to be read by people browsing the audit screen.
 *
 * So the rule is the same in both places and it is not "be careful": a value
 * whose key looks secret is never written, by anyone, for any reason.
 */

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "cookies",
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
  // Not a secret, but a field that must never be shown next to one: a leaked
  // reset token is a leaked credential, and a row that shows only the email
  // address is not a useful audit record.
  "passwordresettoken",
  "emailverificationtoken",
  "mfa-secret",
  "mfa-secret-backup-codes",
  "twofactorsecret",
]);

export const REDACTED = "[redacted]";

/** The keys this module treats as secret. Exported for the tests that pin it. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * Replace secret-bearing values rather than dropping their keys.
 *
 * Keeping the key matters: a line that says `password: undefined` reads like
 * "no password was sent", which is a different claim from "a password was sent
 * and is not written down", and only the second is true.
 *
 * Depth-limited rather than cycle-detected. A cycle in audit data would be a bug
 * worth finding, and a self-referential object recursing until the stack gives
 * out turns that bug into a crash inside a function whose job is to make a log
 * line. Past the limit the value is replaced rather than followed, so the
 * truncation is visible instead of silent.
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
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(inner, depth + 1);
    }
    return out;
  }
  return value;
}
