import {
  accessFor,
  DOCUMENTED_ROUTES,
  documentedPermission,
  type Endpoint,
  firstBodyReadOffset,
  guardedButNotGated,
  handlerAccess,
  handlerDocumentedPermission,
  IMPLEMENTED_ENDPOINTS,
  ROUTE_TREE,
} from "@tests/support/api-route-tree";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, isPermission } from "@/modules/rbac/permissions";

/**
 * Every endpoint's guard, checked against the table that publishes it.
 *
 * Two other suites already cover this ground, and neither covers it:
 *
 * - `permission-matrix.test.ts` proves the *guard* honours the role matrix,
 *   61 permissions against 4 roles in both directions. It never touches a
 *   route, so every one of the 88 handlers could call the guard with the wrong
 *   permission and the matrix would stay green. The matrix answers "does this
 *   check work"; nothing answered "is this check called".
 * - `api-routes.test.ts` proves the route *paths* agree with the doc. The
 *   permission column is in the same tables and was not compared to anything.
 *
 * This suite is the missing third: for all 88 method/path pairs, the permission
 * the handler actually requires is the permission `docs/API.md` publishes, and
 * that permission exists in the catalogue. A wrong constant fails here with a
 * `403` in production attributed to a code that was never granted to anybody.
 *
 * Three directions, because each fails for a different reason:
 *
 * 1. A guard that disagrees with its own doc row. The dangerous one — a client
 *    author reads the table, sends the documented permission, and is refused.
 * 2. A doc row naming a permission the catalogue does not have. Silent in
 *    production: nothing can be granted that does not exist, so the endpoint is
 *    unreachable for every role including the owner.
 * 3. A catalogue permission no route checks. Also silent, and the other way
 *    round: a permission that looks enforced and is not.
 */

/**
 * The access every endpoint is documented to require, keyed by endpoint.
 *
 * Built once so the two sides of every assertion below are computed from the
 * same read of the same two files.
 */
const documented = new Map(
  DOCUMENTED_ROUTES.map((route) => [route.endpoint, route.permissionCell]),
);

/** Endpoint key to the handler that serves it. */
const enforced = new Map<
  Endpoint,
  (typeof ROUTE_TREE)[number]["handlers"][number]
>(
  ROUTE_TREE.flatMap((route) =>
    route.handlers.map(
      (handler) =>
        [`${handler.method} ${route.path}` as Endpoint, handler] as const,
    ),
  ),
);

/**
 * Catalogue entries with no endpoint behind them yet.
 *
 * All of them belong to organisation, member and role management, which Phase 1
 * reaches through invitations and onboarding rather than through endpoints. They
 * are declared here so a role editor can offer them and so a future route has
 * something to check against, but nothing enforces them yet, so nothing is
 * refused on their account either.
 *
 * Listed rather than ignored, because the alternative — a test that only fails
 * for permissions nobody has wired up — is a test that cannot tell a deliberate
 * gap from an accidental one. Adding a catalogue entry without a route fails
 * here, by name.
 */
const DECLARED_AHEAD_OF_THE_ENDPOINT = [
  "activities.update",
  "organization.delete",
  "organization.read",
  "organization.settings",
  "organization.transferOwnership",
  "organization.update",
  "roles.create",
  "roles.delete",
  "roles.read",
  "roles.update",
  "users.invite",
  "users.read",
  "users.remove",
  "users.update",
] as const;

describe("every endpoint's guard matches the table that publishes it", () => {
  it("found both sides to compare", () => {
    // Both sides empty is the failure mode where this passes forever: a moved
    // directory, a renamed heading, a doc table that stopped being markdown. A
    // guard against no routes and a guard against no rows are equally vacuous.
    expect(IMPLEMENTED_ENDPOINTS.length).toBeGreaterThan(0);
    expect(DOCUMENTED_ROUTES.length).toBeGreaterThan(0);
    expect(enforced.size).toBe(IMPLEMENTED_ENDPOINTS.length);
  });

  it("requires exactly what docs/API.md says each endpoint requires", () => {
    const drift = [...enforced.entries()]
      .filter(([endpoint, handler]) => {
        const cell = documented.get(endpoint);
        return (
          cell === undefined ||
          documentedPermission(cell) !== accessFor(endpoint, handler)
        );
      })
      .map(([endpoint, handler]) => {
        const cell = documented.get(endpoint);
        return `${endpoint}: code requires ${accessFor(endpoint, handler)}, doc says "${cell ?? "<no row>"}"`;
      })
      .sort();

    expect(drift).toEqual([]);
  });

  it("names a permission that exists in the catalogue", () => {
    // `audit.read` sat in the audit-logs row for months of Phase 1 and does not
    // exist: the catalogue calls it `auditLogs.read`. Nothing refused on it,
    // because nothing could — and the row read like a working contract to
    // anybody who consulted it.
    const NOT_A_PERMISSION = ["public", "authenticated", "session-optional"];

    const invented = DOCUMENTED_ROUTES.filter(({ permissionCell }) => {
      const access = documentedPermission(permissionCell);
      return NOT_A_PERMISSION.includes(access) ? false : !isPermission(access);
    }).map(
      ({ endpoint, permissionCell }) =>
        `${endpoint}: "${permissionCell}" names no permission in the catalogue`,
    );

    expect(invented).toEqual([]);
  });

  it("keeps a handler's own Permission comment honest", () => {
    // Only the handlers that carry the comment are checked, and 38 of 75 do.
    // The comment is what a reviewer reads when deciding whether a permission
    // can be relaxed, so one that disagrees with the guard is worse than none.
    const contradictory = [...enforced.entries()].flatMap(
      ([endpoint, handler]) => {
        const claimed = handlerDocumentedPermission(handler);
        if (claimed === undefined) return [];

        const actual = handlerAccess(handler.body);
        return actual === claimed
          ? []
          : [`${endpoint}: comment says ${claimed}, guard requires ${actual}`];
      },
    );

    expect(contradictory).toEqual([]);
  });

  it("runs the guard before the body is read", () => {
    // This is what makes a permission refusal independent of what the caller
    // sent. A viewer posting an empty body to `POST /crm/tags` is refused for
    // lacking `tags.create`, so the status is 403 and not 422 — and the sweep in
    // `route-permission-enforcement.test.ts` can send no valid bodies at all
    // because of it. Reversing the order would make every refusal in that sweep
    // a validation failure, which passes for the wrong reason.
    const late = [...enforced.entries()].flatMap(([endpoint, handler]) => {
      const guard = /requirePermission\(\s*"[^"]+"\s*\)/.exec(handler.body);
      if (!guard) return [];

      return firstBodyReadOffset(handler) < guard.index
        ? [`${endpoint}: reads the body before the guard`]
        : [];
    });

    expect(late).toEqual([]);
  });

  it("leaves no catalogue permission that nothing checks", () => {
    const checked = new Set(
      [...enforced.values()].map((handler) => handlerAccess(handler.body)),
    );

    const undeclared = ALL_PERMISSIONS.filter(
      (permission) =>
        !checked.has(permission) &&
        !DECLARED_AHEAD_OF_THE_ENDPOINT.includes(
          permission as (typeof DECLARED_AHEAD_OF_THE_ENDPOINT)[number],
        ),
    ).sort();

    expect(undeclared).toEqual([]);
  });

  it("lists no endpoint as session-optional unless it reads a session and requires none", () => {
    // The exception table is keyed by endpoint because the distinction cannot be
    // read from the source: `POST /auth/logout` and `POST /organizations/active`
    // both call `getSession()` and neither calls `requireUser()`. Checked here so
    // the table cannot quietly grow an entry that a source scan would have got
    // right on its own, which is how an exception list starts answering
    // questions the code can answer.
    const unfounded = guardedButNotGated()
      .filter(
        ({ handler }) =>
          !/getSession\(/.test(handler.body) ||
          /requireUser\(|requirePermission\(/.test(handler.body),
      )
      .map(({ endpoint }) => endpoint);

    expect(unfounded).toEqual([]);
  });

  it("declares each endpoint's mount prefix once", () => {
    // `mountedPath` is what the enforcement sweep requests. If it were assembled
    // from a constant that disagreed with the tree, every request would 404 and
    // the sweep would report a refusal for the wrong reason on every endpoint.
    const malformed = ROUTE_TREE.filter(
      (route) => !route.mountedPath.startsWith("/api/v1/"),
    ).map((route) => route.path);

    expect(malformed).toEqual([]);
  });
});
