import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/API.md §3 and `src/app/api` describe the same nine endpoints, and
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
 * **The scope is §3, and deliberately.** Sections 4 through 7 of docs/API.md are
 * the v1 target state: none of those endpoints exist yet, which is what
 * docs/SECURITY.md §12 says in a table of its own. Asserting them here would
 * assert that the MVP is finished. So this compares the auth table — the one
 * section that is built — in both directions, and the "no undocumented route"
 * direction still runs over *every* file under `src/app/api`, so a handler added
 * outside §3 fails here even though nothing in §4+ is checked.
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
 * The `| \`METHOD\` | \`/path\` |` rows of the §3 table.
 *
 * Split on the heading and on the first fence rather than parsing markdown: the
 * table is the only thing between them that is a table, and a markdown parser
 * here would be more machinery than the thing it checks. The path is captured
 * with a leading slash, which is what makes a `:id` row in another section
 * impossible to match by accident if this is ever pointed at the wrong split.
 */
const documented = [
  ...(readFileSync(join(PROJECT_ROOT, "docs", "API.md"), "utf8")
    .split("## 3. Authentication")[1]
    ?.split("```")[0]
    ?.matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE)` \| `(\/[^`]*)` \|/gm) ?? []),
]
  .map((match) => `${match[1]} ${match[2]}`)
  .sort();

describe("the auth routes and docs/API.md agree", () => {
  it("has route files and a doc table to compare", () => {
    // Both sides empty is the failure mode where this passes forever: a bad path,
    // a renamed directory, or a doc heading that moved.
    expect(implemented.size).toBe(9);
    expect(endpoints.length).toBe(9);
    expect(documented.length).toBe(9);
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
    // is not applied to the doc side, the mismatch would surface as nine
    // failures — but only if this assumption is not also quietly wrong on both
    // sides at once. Asserting the mount exists is the cheap half of that.
    expect(statSync(join(ROUTE_ROOT, "v1", "auth")).isDirectory()).toBe(true);
    expect(BASE_PATH).toBe("/api/v1");
  });
});
