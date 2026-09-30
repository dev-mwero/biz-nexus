import { SESSION_TTL_DAYS } from "@/modules/identity/session.model";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";
import {
  clearSessionCookie,
  readCookie,
  sessionCookie,
} from "@/shared/http/cookie";

/**
 * Reading a session off a `Request`, and writing one back.
 *
 * These take the `Request` as an argument rather than reading `cookies()` from
 * `next/headers`, which is what lets the contract tests drive the real route
 * handlers with real cookies and no Next.js request context. Cookie handling is
 * the part of an auth endpoint most likely to be quietly wrong, so it is the
 * part worth testing for real.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cookie lifetime in seconds, derived from the same constant that sets the
 * session row's `expiresAt`.
 *
 * The cookie must not outlive the row. A browser holding a cookie for longer
 * than the session is valid just sends a dead token on every request, and the
 * apparent result is intermittent sign-outs that are painful to reproduce.
 */
export const SESSION_COOKIE_MAX_AGE = SESSION_TTL_DAYS * DAY_MS;

export function sessionTokenFrom(request: Request): string | null {
  return readCookie(request, SESSION_COOKIE);
}

export function setSessionCookie(token: string): string {
  return sessionCookie(token, SESSION_COOKIE_MAX_AGE);
}

export function unsetSessionCookie(): string {
  return clearSessionCookie();
}

export interface RequestMeta {
  userAgent: string | null;
  ip: string | null;
}

/**
 * The request attributes worth recording against a session or a reset token.
 *
 * Both are hints for a human reviewing "was this really me?" and neither is
 * trusted, so both are best-effort and nullable. The address comes from
 * `x-forwarded-for` because this app is meant to sit behind a proxy; the first
 * entry is the original client. An absent header yields null rather than a guess.
 */
export function requestMeta(request: Request): RequestMeta {
  const forwarded = request.headers.get("x-forwarded-for");
  return {
    userAgent: request.headers.get("user-agent"),
    ip:
      forwarded?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null,
  };
}
