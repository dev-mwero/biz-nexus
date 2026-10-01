/**
 * Cookie name and path classification for the proxy.
 *
 * Deliberately imports nothing.
 *
 * `src/proxy.ts` runs before rendering, and the Next.js docs are explicit that
 * a proxy should not rely on shared modules or globals, because it may be
 * deployed to a CDN for redirect handling. Importing the Data Access Layer from
 * here would pull in `next/headers` and Mongoose - a database client in a
 * bundle meant to answer "does a cookie exist" in a few microseconds.
 *
 * So the cookie name and the path rules live here, in a module with no imports
 * at all, and both the proxy and the DAL import it from there. One source of
 * truth, and the proxy's dependency graph stays empty.
 */

/**
 * The session cookie's name.
 *
 * `bn_` rather than `__Host-`, and the reason is worth writing down because
 * `__Host-` looks strictly better. The `__Host-` prefix obliges the cookie to be
 * `Secure`, `Path=/` and free of `Domain` — which means the browser will not store
 * it at all over plain HTTP. That is correct for production and fatal for
 * `next dev` on `http://localhost`, where the developer is signing in on every
 * change and a cookie that silently vanishes looks like broken auth. A `__Host-`
 * prefix would have to be made conditional on the environment, and an
 * environment-dependent cookie name is a cookie name that differs between the
 * place you test and the place you deploy.
 *
 * So the prefix here is a namespace, and the isolation that `__Host-` would have
 * given up is bought explicitly instead: `Path=/` and no `Domain` in
 * `src/shared/http/cookie.ts`, which is the part of `__Host-` that protects
 * against a sibling subdomain overwriting the cookie. `Secure` comes from the
 * environment, so the remaining gap is host-only fixation by a parent domain,
 * which is a deployment decision and is listed in docs/SECURITY.md §7.
 */
export const SESSION_COOKIE = "bn_session";

/**
 * Where an unauthenticated visitor is sent.
 *
 * Route group `(auth)` — parentheses keep it out of the URL, so this is `/sign-in`
 * and not `/(auth)/sign-in`.
 */
export const SIGN_IN_PATH = "/sign-in";

/** Where a signed-in visitor lands after signing in. */
export const DEFAULT_AUTHENTICATED_PATH = "/app";

/**
 * Prefixes that require a session cookie to be present.
 *
 * The authenticated shell is `(app)`, which is not a URL segment, so its pages
 * are matched individually. This is a UX redirect list and nothing more: a path
 * missing from it is not unprotected, it is merely not redirected. The DAL is
 * the control, and it guards every route regardless of what is listed here.
 */
export const PROTECTED_PREFIXES = [
  // `/app` is a legacy alias that redirects to the dashboard; kept so the proxy
  // still fronts it. The rest mirror the real page tree, which nests contacts,
  // companies, leads and saved views under `/crm` rather than at the root.
  "/app",
  "/dashboard",
  "/crm",
  "/deals",
  "/pipelines",
  "/tasks",
  "/activities",
  "/search",
  "/notifications",
  "/settings",
  "/saved-views",
  "/audit-logs",
] as const;

/** Pages that are pointless to show to somebody who is already signed in. */
export const AUTH_PATHS = [
  SIGN_IN_PATH,
  "/sign-up",
  "/forgot-password",
  "/reset-password",
] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Make a `?next=` value safe to redirect to.
 *
 * Without this, `?next=https://evil.example` or `?next=//evil.example` turns
 * the sign-in page into an open redirect: sign in, and the user lands on a
 * convincing copy of the product. Accepted values are a single leading slash
 * and nothing that could be read as a scheme or a host.
 */
export function safeNextPath(
  candidate: string | null | undefined,
): string | null {
  if (!candidate) return null;
  if (!candidate.startsWith("/")) return null;
  // `//host` and `/\host` are protocol-relative URLs, not local paths.
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return null;
  if (candidate.includes(":")) return null;
  // Control characters can truncate the Location header in some clients.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to detect them.
  if (/[\x00-\x1f\x7f]/.test(candidate)) return null;

  return candidate;
}
