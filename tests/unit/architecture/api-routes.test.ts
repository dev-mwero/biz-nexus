import { statSync } from "node:fs";
import { join } from "node:path";
import {
  BASE_PATH,
  DOCUMENTED_ROUTES,
  IMPLEMENTED_ENDPOINTS,
  ROUTE_ROOT,
} from "@tests/support/api-route-tree";
import { describe, expect, it } from "vitest";

/**
 * `docs/API.md` and `src/app/api` describe the same implemented endpoints, and
 * nothing kept them in step.
 *
 * The drift this catches is the expensive kind. A route added without a doc row
 * is a capability nobody knows exists, and a doc row without a route is a
 * promise the server does not keep — a client written against the second fails
 * in production, not in review, because the table is the thing a client author
 * reads. Neither is a type error, and neither is visible from a diff of the other
 * file.
 *
 * Two-way on purpose. A check that only asserts "every route is documented"
 * passes forever once the routes stop moving, and a check that only asserts "every
 * documented route exists" passes the moment somebody deletes a handler. Each
 * direction alone is half a drift catcher; the pair is the whole of it.
 *
 * The comparison covers every endpoint table in the API reference. A documented
 * endpoint without a handler is as material a drift as a handler without docs.
 *
 * The path derivation, and the reading of the doc rows, live in
 * `tests/support/api-route-tree.ts`. `route-permissions.test.ts` compares the
 * *permission* column of the same tables against the guards, and two copies of
 * that derivation would be two chances to compare the wrong thing.
 */

const endpoints = IMPLEMENTED_ENDPOINTS;
const documented = DOCUMENTED_ROUTES.map((route) => route.endpoint);

describe("the auth routes and docs/API.md agree", () => {
  it("has route files and a doc table to compare", () => {
    // Both sides empty is the failure mode where this passes forever: a bad path,
    // a renamed directory, or a doc heading that moved.
    expect(endpoints.length).toBeGreaterThan(0);
    expect(documented.length).toBeGreaterThan(0);
  });

  it("documents every route that exists", () => {
    // Direction one: the route is the capability, the doc row is the record of
    // it. An undocumented route is invisible to anybody who reads the doc.
    expect(
      endpoints.filter((endpoint) => !documented.includes(endpoint)),
    ).toEqual([]);
  });

  it("has a route for every endpoint it documents", () => {
    // Direction two: the doc row is the promise. A client is written against
    // this table, so a row with no handler is a 404 discovered in production.
    expect(
      documented.filter((endpoint) => !endpoints.includes(endpoint)),
    ).toEqual([]);
  });

  it("does not serve a method the doc does not name", () => {
    // Asserted separately from the pair above because a route that added a
    // handler should fail as an extra capability, not as a missing document —
    // the two point at different fixes.
    const undocumented = endpoints.filter(
      (endpoint) => !documented.includes(endpoint),
    );

    expect(undocumented).toEqual([]);
  });

  it("derives the paths from a tree that is actually mounted where the doc says", () => {
    // The derived paths have the `/api/v1` prefix stripped, on the assumption
    // that the directory tree says so. If the version segment were renamed, every
    // path would become `/api/v2/auth/...`, and because the same wrong assumption
    // sides at once. Asserting the mount exists is the cheap half of that.
    expect(statSync(join(ROUTE_ROOT, "v1", "auth")).isDirectory()).toBe(true);
    expect(BASE_PATH).toBe("/api/v1");
  });
});
