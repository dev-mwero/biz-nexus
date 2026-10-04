import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * The shape of the API, derived from the two places it is written down.
 *
 * `src/app/api` is the capability: the handlers that exist. `docs/API.md` is the
 * promise: the table a client author reads. Three suites need both sides and
 * would otherwise each grow their own copy of the derivation — the path surgery
 * below especially, which is the kind of code that has to be identical in every
 * place or the comparison quietly compares the wrong thing. One derivation, and
 * the assertions on top of it.
 *
 * Nothing here asserts. This module reads two files and hands back maps; a
 * helper that made a judgement would be a helper nobody could check.
 */

export const PROJECT_ROOT = resolve(process.cwd());

/**
 * `src/app`, not `src/app/api`, so the derived path carries the whole mount
 * including `/api` and the version segment. Both are then removed by the same
 * constant the doc states them in, which is the only way the removal is
 * checkable — strip from `src/app/api` instead and the `/v1` would survive into
 * every path, on both sides, and the suite would still be green.
 */
export const APP_ROOT = join(PROJECT_ROOT, "src", "app");
export const ROUTE_ROOT = join(APP_ROOT, "api");

/** The mount prefix, as docs/API.md §11 states it. Stripped from both sides. */
export const BASE_PATH = "/api/v1";

/** The methods a `route.ts` may export. Next treats anything else as 405. */
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type Method = (typeof METHODS)[number];

/** Endpoint key, `METHOD /path`, the form both the doc and the tests use. */
export type Endpoint = `${Method} ${string}`;

/**
 * Every handler export in a file, with its method and position.
 *
 * One pattern for all five methods, so a handler's end is simply the start of
 * the next export in *file order* — which is what makes slicing possible.
 * Matching per method instead would put `DELETE` next to `POST` regardless of
 * which comes first on disk, and the slice for `GET /deals/:id` would then
 * contain the whole of `PATCH /deals/:id`.
 */
const HANDLER_EXPORT =
  /^[ \t]*export[ \t]+(?:const|async[ \t]+function|function)[ \t]+(GET|POST|PUT|PATCH|DELETE)\b/gm;

export function* routeFiles(dir: string): Generator<string> {
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
export function requestPath(file: string): string {
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
  // comparisons below will say so by name rather than by mangled path.
  return path.startsWith(`${BASE_PATH}/`) ? path.slice(BASE_PATH.length) : path;
}

/** The module specifier that reaches a route's handlers, `@/app`-relative. */
export function modulePath(file: string): string {
  return `@/${relative(APP_ROOT, file).split(sep).join("/").replace(/\.ts$/, "")}`;
}

/**
 * One exported handler, split into its two halves.
 *
 * The split is the point. A handler's doc comment sits *above* its export, so a
 * slice running from one export to the next swallows the next handler's comment
 * — and reading `Permission:` out of such a slice attributes every comment in
 * the file to the handler above it. `companies.create` on the `GET /crm/companies`
 * slice is what that looks like.
 */
export interface Handler {
  method: Method;
  /** The contiguous comment block immediately above the export, if any. */
  doc: string;
  /** The handler itself: from its export to the next export in the file. */
  body: string;
  /** `doc` and `body` together, for the checks that want the whole span. */
  source: string;
}

/** The comment block immediately above `index`, walked up while lines are comments. */
function commentAbove(source: string, index: number): string {
  const before = source.slice(0, index);
  const lines = before.split("\n");

  const block: string[] = [];
  for (let line = lines.length - 1; line >= 0; line -= 1) {
    const text = lines[line];
    if (/^\s*$/.test(text)) {
      // One blank line between a comment and its export is a formatting habit,
      // not a second comment block.
      if (block.length > 0) break;
      continue;
    }
    if (!/^\s*(\*|\/\*\*|\/\/)/.test(text)) break;
    block.unshift(text);
  }

  return block.join("\n");
}

/** One route file: its path, its import specifier, and a slice per handler. */
export interface RouteFile {
  file: string;
  /** The path as docs/API.md writes it, without the mount prefix. */
  path: string;
  /** The path a client actually requests, mount prefix included. */
  mountedPath: string;
  module: string;
  /** One entry per exported method. */
  handlers: Handler[];
}

function routeFile(file: string): RouteFile {
  const source = readFileSync(file, "utf8");
  const exports = [...source.matchAll(HANDLER_EXPORT)];

  const handlers = exports.map((match, index): Handler => {
    const start = match.index;
    const next = exports[index + 1]?.index ?? source.length;
    const doc = commentAbove(source, start);
    const body = source.slice(start, next);

    return { method: match[1] as Method, doc, body, source: `${doc}\n${body}` };
  });

  const path = requestPath(file);

  return {
    file,
    path,
    mountedPath: `${BASE_PATH}${path}`,
    module: modulePath(file),
    handlers,
  };
}

/** Every route file, with its handler slices. */
export const ROUTE_TREE: RouteFile[] = [...routeFiles(ROUTE_ROOT)].map(
  routeFile,
);

/** Every method/path pair a `route.ts` exports, sorted. */
export const IMPLEMENTED_ENDPOINTS: Endpoint[] = ROUTE_TREE.flatMap((route) =>
  route.handlers.map((handler) => `${handler.method} ${route.path}`),
).sort() as Endpoint[];

/** The endpoint a route file serves, for a given method, or throw. */
export function handlerFor(method: Method, path: string): Handler {
  const handler = ROUTE_TREE.find(
    (route) => route.path === path,
  )?.handlers.find((candidate) => candidate.method === method);

  if (!handler) {
    throw new Error(`No ${method} handler for ${path} in src/app/api.`);
  }

  return handler;
}

/** One doc row: the endpoint, and the whole permission cell. */
export interface DocumentedRoute {
  endpoint: Endpoint;
  permissionCell: string;
}

/**
 * The `| \`METHOD\` | \`/path\` | <cell> |` rows across the API reference.
 *
 * A markdown parser would be more machinery than the thing it checks. Restricted
 * to table rows with a supported HTTP method and a leading-slash path, which is
 * every endpoint row in the document and nothing else. Query strings describe
 * filters, not distinct routes, so they are stripped rather than matched.
 */
export const DOCUMENTED_ROUTES: DocumentedRoute[] = [
  ...readFileSync(join(PROJECT_ROOT, "docs", "API.md"), "utf8").matchAll(
    /^\| `(GET|POST|PUT|PATCH|DELETE)` \| `(\/[^`]*)` \| ([^|]*)\|/gm,
  ),
]
  .map((match) => ({
    endpoint: `${match[1]} ${match[2].split("?")[0]}` as Endpoint,
    permissionCell: match[3].trim(),
  }))
  .filter(
    (route, index, all) =>
      all.findIndex((other) => other.endpoint === route.endpoint) === index,
  )
  .sort((a, b) => a.endpoint.localeCompare(b.endpoint));

/**
 * What a route demands, as the cases the API actually has: a permission code,
 * `authenticated` for a session and nothing more, `session-optional` for a
 * handler that reads a session without requiring one, or `public`.
 */
export type Access =
  | "public"
  | "authenticated"
  | "session-optional"
  | (string & {});

const PERMISSION_CODE = /`([a-zA-Z]+\.[a-zA-Z]+)`/;

/**
 * Endpoints whose session check is a read rather than a gate.
 *
 * `POST /auth/logout` is the only one. It calls `getSession()` and answers `200`
 * to a caller who has no session, deliberately: a sign-out button must not
 * report an error to somebody already signed out, and a `401` here would make
 * the endpoint a way to ask whether a given token is still live.
 *
 * Keyed by endpoint rather than derived from the source, because the difference
 * is not derivable. `POST /organizations/active` reads a session the same way and
 * throws `UNAUTHENTICATED` by hand three lines later; the only thing separating
 * the two is an explicit throw in a branch, which is not something a source scan
 * can follow. A third handler written either way is still caught: an
 * unrecognised one is classified `authenticated`, which fails the 401 sweep in
 * `route-permission-enforcement.test.ts` if the code agrees and the drift
 * comparison here if the doc does not.
 */
const GUARDED_BUT_NOT_GATED: Record<string, Access> = {
  "POST /auth/logout": "session-optional",
};

/**
 * Reduce a doc permission cell to the access it describes.
 *
 * A cell may name a permission and then explain it — `` `deals.delete` — soft
 * delete`` — or name no permission at all, because `—` means the endpoint is
 * public, `authenticated` means a session is the requirement, and
 * `session optional` means the handler reads one without requiring it. Reading
 * the first code out of the cell handles the permission case. A cell that
 * reduces to none of them is returned verbatim, so the test names it instead of
 * passing on a default: a permission cell this function cannot read is a cell a
 * client author cannot use either.
 */
export function documentedPermission(cell: string): Access {
  const code = PERMISSION_CODE.exec(cell);
  if (code) return code[1];

  if (cell.startsWith("—") || cell === "") return "public";
  if (cell.startsWith("authenticated")) return "authenticated";
  if (cell.startsWith("session optional")) return "session-optional";

  return cell;
}

/**
 * The guard a handler actually calls, read out of its source.
 *
 * The cases mirror the guards in `createAuthGuards`. A handler that calls
 * `requirePermission` is gated on that permission and nothing weaker matters —
 * `auth/me` calls `requireOrg` as well as `requireUser`, and the session check
 * is the one that decides. A handler that reaches only for a session or a user
 * is authenticated. A handler that calls no guard at all is public, which is a
 * claim about the endpoint rather than an omission, and is exactly the claim
 * worth asserting.
 */
export function handlerAccess(source: string): Access {
  const permission = /requirePermission\(\s*"([^"]+)"/.exec(source);
  if (permission) return permission[1];

  if (/requireUser\(|getSession\(|requireOrg\(/.test(source)) {
    return "authenticated";
  }

  return "public";
}

/**
 * What an endpoint actually demands, exceptions applied.
 *
 * `handlerAccess` is the static reading and this is the answer the tests assert
 * on, so the two cannot be confused for one another.
 */
export function accessFor(endpoint: Endpoint, handler: Handler): Access {
  return GUARDED_BUT_NOT_GATED[endpoint] ?? handlerAccess(handler.body);
}

/**
 * The endpoints whose session check is a read, with the handler behind each.
 *
 * Exported so the sweep can assert on them by name rather than re-deriving the
 * table, and so the architecture test can check that every entry is genuinely
 * the shape it claims to be.
 */
export function guardedButNotGated(): Array<{
  endpoint: Endpoint;
  handler: Handler;
}> {
  return ROUTE_TREE.flatMap((route) =>
    route.handlers
      .filter(
        (handler) =>
          GUARDED_BUT_NOT_GATED[`${handler.method} ${route.path}`] !==
          undefined,
      )
      .map((handler) => ({
        endpoint: `${handler.method} ${route.path}` as Endpoint,
        handler,
      })),
  );
}

/**
 * The `Permission:` line in a handler's own doc comment, if it carries one.
 *
 * Only 38 of the 75 permission-gated handlers have it, so it is checked where
 * present rather than required. It is worth checking at all: the comment is what
 * a reviewer reads when deciding whether a permission can be relaxed, and a
 * comment that disagrees with the guard is worse than no comment.
 *
 * Read from {@link Handler.doc} and nowhere else. See {@link Handler} for why a
 * slice from export to export gets this wrong.
 */
export function handlerDocumentedPermission(
  handler: Handler,
): string | undefined {
  return /Permission:\s*`?([a-zA-Z]+\.[a-zA-Z]+)`?/.exec(handler.doc)?.[1];
}

/**
 * The first point at which a handler reads the request body.
 *
 * Used to assert the guard runs first. It matters because it is what makes a
 * permission refusal independent of what the caller sent: a viewer posting an
 * empty body to `POST /crm/tags` is refused for lacking `tags.create` rather
 * than for lacking a `name`, so the status is `403` and not `422`. The sweep in
 * `route-permission-enforcement.test.ts` sends no valid bodies at all, and that
 * is only sound because of this ordering.
 */
export function firstBodyReadOffset(handler: Handler): number {
  const read = /readJson\(|parseBody\(|request\.json\(/.exec(handler.body);
  return read?.index ?? Number.POSITIVE_INFINITY;
}
