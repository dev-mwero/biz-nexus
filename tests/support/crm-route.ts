import { GET as companyContacts } from "@/app/api/v1/crm/companies/[id]/contacts/route";
import { POST as companyRestore } from "@/app/api/v1/crm/companies/[id]/restore/route";
import {
  DELETE as companyDelete,
  GET as companyGet,
  PATCH as companyPatch,
} from "@/app/api/v1/crm/companies/[id]/route";
import {
  GET as companiesIndexGet,
  POST as companiesIndexPost,
} from "@/app/api/v1/crm/companies/route";
import { POST as contactMerge } from "@/app/api/v1/crm/contacts/[id]/merge/route";
import { POST as contactRestore } from "@/app/api/v1/crm/contacts/[id]/restore/route";
import {
  DELETE as contactDelete,
  GET as contactGet,
  PATCH as contactPatch,
} from "@/app/api/v1/crm/contacts/[id]/route";
import {
  GET as contactsIndexGet,
  POST as contactsIndexPost,
} from "@/app/api/v1/crm/contacts/route";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * Calling the real CRM route handlers from a test.
 *
 * These suites used to `fetch("http://localhost:3000/...")`, which fails in CI
 * and in a plain `npm test` because nothing is listening, so every test in both
 * files failed unconditionally and the file cost six minutes to prove it. The
 * handlers take a `Request` and return a `Response` like anything else, so the
 * request is constructed here and handed straight to the route it names.
 *
 * The point of routing through `Request` rather than the service is unchanged:
 * the session cookie is parsed by the same code, the origin check runs, the
 * permission guard is the real one, and `pathParam` reads the id out of the URL
 * exactly as it would in production.
 */

const ORIGIN = "http://localhost:3000";

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

type Handler = (request: Request) => Promise<Response>;

/**
 * The route table, keyed by a pattern rather than a concrete id.
 *
 * Every pattern is anchored at both ends, so a nested path cannot be claimed by
 * the shorter one above it: `/contacts/:id` does not match
 * `/contacts/:id/restore`. An unanchored pattern here once hid a real defect —
 * the restore handlers were exported from `[id]/route.ts`, so Next served them
 * at `/companies/:id` and no `/restore` endpoint existed at all, while the
 * table answered `/restore` from the `[id]` module and the suite passed.
 *
 * Each entry now imports the module that actually sits at that path, so a
 * handler moved to the wrong segment shows up as a missing import rather than as
 * a green test.
 */
const ROUTES: Array<{ method: string; pattern: RegExp; handler: Handler }> = [
  {
    method: "GET",
    pattern: /^\/api\/v1\/crm\/contacts$/,
    handler: contactsIndexGet,
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/crm\/contacts$/,
    handler: contactsIndexPost,
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/crm\/contacts\/([^/]+)$/,
    handler: contactGet,
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/crm\/contacts\/([^/]+)$/,
    handler: contactPatch,
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v1\/crm\/contacts\/([^/]+)$/,
    handler: contactDelete,
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/crm\/contacts\/([^/]+)\/merge$/,
    handler: contactMerge,
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/crm\/contacts\/([^/]+)\/restore$/,
    handler: contactRestore,
  },

  {
    method: "GET",
    pattern: /^\/api\/v1\/crm\/companies$/,
    handler: companiesIndexGet,
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/crm\/companies$/,
    handler: companiesIndexPost,
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/crm\/companies\/([^/]+)$/,
    handler: companyGet,
  },
  {
    method: "PATCH",
    pattern: /^\/api\/v1\/crm\/companies\/([^/]+)$/,
    handler: companyPatch,
  },
  {
    method: "DELETE",
    pattern: /^\/api\/v1\/crm\/companies\/([^/]+)$/,
    handler: companyDelete,
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/crm\/companies\/([^/]+)\/restore$/,
    handler: companyRestore,
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/crm\/companies\/([^/]+)\/contacts$/,
    handler: companyContacts,
  },
];

function handlerFor(method: string, pathname: string): Handler {
  const route = ROUTES.find(
    (candidate) =>
      candidate.method === method && candidate.pattern.test(pathname),
  );

  if (!route) {
    throw new Error(
      `No CRM route handler for ${method} ${pathname}. Add it to tests/support/crm-route.ts.`,
    );
  }

  return route.handler;
}

export interface CallRouteInit {
  method?: string;
  body?: unknown;
  token?: string;
  /**
   * Overrides the Origin header. A test that wants to prove the origin check
   * refuses a foreign origin needs to be able to send one.
   */
  origin?: string;
}

/**
 * Invoke the route the path names, and return its `Response`.
 *
 * A token becomes a real `bn_session` cookie rather than the `session` name the
 * application never reads, so these tests assert on a session the product
 * would accept.
 */
export async function callRoute(
  path: string,
  init: CallRouteInit = {},
): Promise<Response> {
  const method = init.method ?? "GET";
  const url = new URL(path, ORIGIN);
  const headers = new Headers({ origin: init.origin ?? ORIGIN });

  if (init.token) headers.set("cookie", `${SESSION_COOKIE}=${init.token}`);

  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const request = new Request(url, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  return handlerFor(method, url.pathname)(request);
}

/**
 * True when `value` is a 24-character hex id.
 *
 * Used by the suites to assert a 404 came from the handler's own lookup rather
 * than from a 400 on a malformed id, which is a different guarantee.
 */
export function isObjectId(value: unknown): boolean {
  return typeof value === "string" && OBJECT_ID.test(value);
}
