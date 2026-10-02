import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
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
 */

const PROJECT_ROOT = resolve(process.cwd());

/**
 * `src/app`, not `src/app/api`, so the derived path carries the whole mount
 * including `/api` and the version segment. Both are then removed by the same
 * constant the doc states them in, which is the only way the removal is
 * checkable — strip from `src/app/api` instead and the `/v1` would survive into
 * every path, on both sides, and the suite would still be green.
 */
const APP_ROOT = join(PROJECT_ROOT, "src", "app");
const ROUTE_ROOT = join(APP_ROOT, "api");

/** The mount prefix, as docs/API.md §11 states it. Stripped from both sides. */
const BASE_PATH = "/api/v1";

/** The methods a `route.ts` may export. Next treats anything else as 405. */
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function* routeFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* routeFiles(full);
    else if (entry === "route.ts") yield full;
  }
}

/**
 * The request path a `route.ts` serves, as the doc writes it.
 *
 * Two Next conventions are translated rather than compared literally. A dynamic
 * segment is `[id]` on disk and `:id` in the doc, and comparing the raw text
 * would report a mismatch for every future parameterised route — which is the
 * kind of failure a guard like this gets switched off for. A route group,
 * `(marketing)`, is part of the URL structure and nothing else, so it is
 * dropped. Neither convention is used yet; both are handled so that adding one
 * is not also a reason to weaken the check.
 */
function requestPath(file: string): string {
  const segments = relative(APP_ROOT, file)
    .split(sep)
    .slice(0, -1) // the `route.ts` itself
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .map((segment) =>
      segment.startsWith("[") && segment.endsWith("]")
        ? `:${segment.slice(1, -1).replace(/^\.\.\./, "")}`
        : segment,
    );

  const path = `/${segments.join("/")}`;

  // A route outside the documented mount is not a doc drift to be reconciled by
  // prefix surgery — it is a route the doc does not describe at all, and the
  // comparison below will say so by name rather than by mangled path.
  return path.startsWith(`${BASE_PATH}/`) ? path.slice(BASE_PATH.length) : path;
}

/** Every method/path pair a `route.ts` exports. */
function exportedMethods(file: string): string[] {
  const source = readFileSync(file, "utf8");

  return METHODS.filter((method) =>
    // `export const GET` and `export async function GET` are both valid; a
    // mention of the name in a comment is not an export, and the comment cases
    // are handled by requiring the `export` prefix to be on the same line.
    new RegExp(
      `^\\s*export\\s+(?:const|async\\s+function|function)\\s+${method}\\b`,
      "m",
    ).test(source),
  );
}

const implemented = new Map<string, string[]>();
for (const file of routeFiles(ROUTE_ROOT)) {
  implemented.set(requestPath(file), exportedMethods(file));
}

const endpoints = [...implemented.entries()]
  .flatMap(([path, methods]) => methods.map((method) => `${method} ${path}`))
  .sort();

/**
 * The `| \`METHOD\` | \`/path\` |` rows across the API reference.
 *
 * A markdown parser would be more machinery than the thing it checks. Restrict
 * the pattern to table rows with a supported HTTP method and leading-slash path.
 */
// Query strings in docs describe filters, not distinct HTTP routes.
const documented = [
  ...(readFileSync(join(PROJECT_ROOT, "docs", "API.md"), "utf8").matchAll(
    /^\| `(GET|POST|PUT|PATCH|DELETE)` \| `(\/[^`]*)` \|/gm,
  ) ?? []),
]
  .map((match) => `${match[1]} ${match[2].split("?")[0]}`)
  .filter((endpoint, index, all) => all.indexOf(endpoint) === index)
  .sort();

describe("the auth routes and docs/API.md agree", () => {
  it("has route files and a doc table to compare", () => {
    // Both sides empty is the failure mode where this passes forever: a bad path,
    // a renamed directory, or a doc heading that moved.
    expect(implemented.size).toBeGreaterThan(0);
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
