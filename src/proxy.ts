import { type NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_AUTHENTICATED_PATH,
  isAuthPath,
  isProtectedPath,
  SESSION_COOKIE,
  SIGN_IN_PATH,
  safeNextPath,
} from "@/shared/auth/session-cookie";

/**
 * Optimistic session redirect.
 *
 * This checks whether a session cookie is *present*. That is not authentication
 * and is not treated as such: a forged or expired cookie passes straight
 * through here and is rejected later by `requirePermission`. The proxy exists to
 * avoid rendering a page the viewer is about to be bounced off, and nothing
 * else. Every protected route calls a DAL guard, so removing this file would
 * make the product worse to use and no less secure.
 *
 * Which is also why it must not touch the database. It runs on every request
 * and on every prefetch; a query here would multiply connection pressure by an
 * order of magnitude for a check the DAL performs properly anyway. A user who
 * has just been removed from an organization is bounced by the DAL on the very
 * next request, and no stale cookie can carry them through to data.
 *
 * Imports only `next/server` and a module with no imports of its own. See
 * src/shared/auth/session-cookie.ts for why that matters.
 */

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Presence, not value. A cookie set by anything, including an attacker, is
  // equally "present"; verifying it is the DAL's job and doing it here would
  // mean a database call on every request.
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

  if (isProtectedPath(pathname) && !hasSessionCookie) {
    const target = new URL(SIGN_IN_PATH, request.url);
    // Only a safe local path survives safeNextPath, so this cannot be turned
    // into an open redirect by crafting the query string.
    const next = safeNextPath(pathname);
    if (next) target.searchParams.set("next", next);

    return NextResponse.redirect(target);
  }

  if (isAuthPath(pathname) && hasSessionCookie) {
    // Signing in again while already holding a cookie is either a stale tab or
    // a confused user; either way the dashboard is where they meant to be.
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    return NextResponse.redirect(
      new URL(next ?? DEFAULT_AUTHENTICATED_PATH, request.url),
    );
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Everything except the API, static assets, and anything with a file
   * extension. The API is excluded on purpose: an unauthenticated API caller
   * should get a 401 JSON envelope, not an HTML redirect to a sign-in page.
   *
   * `_next/data` is deliberately *not* excluded. Next.js invokes the proxy for
   * those routes even when a matcher skips them, precisely so that protecting a
   * page and forgetting its data route cannot silently leave the data open.
   */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.[\\w]+$).*)",
  ],
};
