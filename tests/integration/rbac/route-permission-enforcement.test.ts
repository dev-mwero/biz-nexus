import { dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accessFor,
  DOCUMENTED_ROUTES,
  type Endpoint,
  ROUTE_TREE,
  type RouteFile,
} from "@tests/support/api-route-tree";
import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase, disconnectDatabase } from "@/db/connection";
import { SessionModel, UserModel } from "@/modules/identity";
import { hashPassword } from "@/modules/identity/password";
import { issueSession } from "@/modules/identity/session.service";
import {
  createOrganization,
  MembershipModel,
  OrganizationModel,
  RoleModel,
} from "@/modules/organizations";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * Every endpoint, called as a caller who is not allowed to call it.
 *
 * The matrix test proves `requirePermission` honours the role table. The
 * architecture test proves every handler calls it with the documented
 * permission. Neither proves the two are connected to the thing a client
 * actually calls: a route can import a guard, guard against the right constant,
 * and still return the record — the failure mode is a guard called after the
 * query, or a handler that catches the refusal and carries on. This suite calls
 * all 88 method/path pairs and reads the status.
 *
 * One actor with no permissions, rather than a VIEWER. A viewer holds every
 * `.read` in the catalogue except `auditLogs.read`, so a sweep against one
 * would only ever exercise the write half, and the read half — 45 of the 88
 * endpoints — would report success and prove nothing. A role with an empty
 * permission list is the only actor that is refused by every check in the
 * catalogue, which is the property that makes one sweep cover every route.
 *
 * No valid bodies are sent, deliberately. The guard runs before the body is read
 * in all 75 permission-gated handlers — asserted structurally in
 * `route-permissions.test.ts` — so a refusal here is a refusal for the permission
 * and not a `422` for a missing `name`. If that ordering ever reverses, this
 * suite fails with `422` where it expects `403`, which is the correct place for
 * that to surface.
 */

/** `env.APP_URL` as tests/setup-env.ts sets it. */
const ORIGIN = "http://localhost:3000";

/**
 * A 24-character hex id, for the `:id` in a documented path.
 *
 * The permission refusal happens before any lookup, so the record does not have
 * to exist. It does have to *parse*, though: `pathParam` validates the segment
 * first and a malformed one is a `400`, which would be a refusal for the wrong
 * reason and would hide a route that never reached its guard.
 */
const ID = new Types.ObjectId().toHexString();

/** The documented path with every parameter filled in. */
function concretePath(route: RouteFile): string {
  return route.mountedPath.replace(/:[a-zA-Z][a-zA-Z0-9]*/g, ID);
}

type HandlerFn = (request: Request) => Promise<Response>;

/**
 * The specifier that reaches a route's handlers, relative to this file.
 *
 * Derived from the file on disk rather than written out by hand. A hand written
 * table of 59 static imports drifts from the tree in exactly the way
 * `tests/support/crm-route.ts` documents: a handler moved to the wrong segment
 * would still be answered by the module the table names, and the sweep would
 * pass against a URL that does not exist. Here a moved handler moves the request
 * with it, and a new route is covered without anybody adding a line.
 *
 * Relative rather than `@/`-prefixed, and not an accident: a dynamic `import()`
 * of a variable specifier is resolved by Node's rules, and Node does not know
 * about this project's `@` alias — it fails with "Cannot find package '@/...'".
 * A path relative to the importer resolves everywhere, including under the
 * coverage provider, which rewrites modules but not specifiers.
 */
function specifierFor(route: RouteFile): string {
  const from = dirname(fileURLToPath(import.meta.url));

  return `../../../${relative(from, route.file).split(sep).join("/").replace(/\.ts$/, "")}`;
}

/** The handler a route file exports for a method. */
async function handlerFor(
  route: RouteFile,
  method: string,
): Promise<HandlerFn> {
  const module = (await import(specifierFor(route))) as Record<string, unknown>;
  const handler = module[method];

  if (typeof handler !== "function") {
    throw new Error(`${route.module} exports no ${method} function.`);
  }

  return handler as HandlerFn;
}

interface Refusal {
  status: number;
  code: string | undefined;
}

async function call(
  route: RouteFile,
  method: string,
  token?: string,
): Promise<Refusal> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (token) headers.cookie = `${SESSION_COOKIE}=${token}`;

  const response = await (await handlerFor(route, method))(
    new Request(new URL(concretePath(route), ORIGIN), {
      method,
      headers,
      // A body is not sent. See the note at the top: the guard runs first, so
      // every refusal below is about the permission and not about the payload.
    }),
  );

  const payload = await response.json().catch(() => ({}));

  return {
    status: response.status,
    code: (payload as { error?: { code?: string } }).error?.code,
  };
}

/**
 * A signed-in member of an organisation, holding a role with no permissions.
 *
 * A custom role rather than a system one, because the system roles are derived
 * from the catalogue and would grow new permissions as the product does. This
 * actor has to stay empty for the sweep to keep its meaning.
 */
let token: string;

beforeAll(async () => {
  await connectToDatabase();

  const user = await UserModel.create({
    email: `sweep-${new Types.ObjectId()}@example.com`,
    name: "Permission Sweep",
    passwordHash: await hashPassword("correct horse battery staple"),
  });
  const { organization } = await createOrganization({
    name: "Sweep Org",
    ownerId: user._id,
  });

  const role = await RoleModel.create({
    organizationId: organization._id,
    key: "NOACCESS",
    name: "No access",
    permissions: [],
    isSystem: false,
  });
  await MembershipModel.updateOne(
    { organizationId: organization._id, userId: user._id },
    { $set: { roleId: role._id } },
  );

  const session = await issueSession({ userId: user._id });
  await SessionModel.updateOne(
    { _id: session.session._id },
    { $set: { activeOrganizationId: organization._id } },
  );
  token = session.token;
});

afterAll(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    OrganizationModel.deleteMany({}),
    RoleModel.deleteMany({}),
    MembershipModel.deleteMany({}),
  ]);

  await disconnectDatabase();
});

/** Endpoint, handler, and the access it demands. */
const CASES = ROUTE_TREE.flatMap((route) =>
  route.handlers.map((handler) => {
    const endpoint = `${handler.method} ${route.path}` as Endpoint;
    return {
      endpoint,
      access: accessFor(endpoint, handler),
      route,
      method: handler.method,
    };
  }),
);

describe("every endpoint refuses a caller with no permissions", () => {
  it("covers every documented endpoint", () => {
    // The sweep is only worth what its coverage is. A route added after this
    // file was written is counted here rather than assumed to be included.
    expect(new Set(CASES.map((c) => c.endpoint))).toEqual(
      new Set(DOCUMENTED_ROUTES.map((row) => row.endpoint)),
    );
  });

  describe.each(
    CASES.filter(
      (c) =>
        c.access !== "public" &&
        c.access !== "authenticated" &&
        c.access !== "session-optional",
    ),
  )("$endpoint", (testCase) => {
    it(`refuses a member holding no permissions with 403 ${testCase.access}`, async () => {
      const refusal = await call(testCase.route, testCase.method, token);

      expect(refusal).toEqual({
        status: 403,
        code: "INSUFFICIENT_PERMISSION",
      });
    });
  });

  describe.each(
    CASES.filter((c) => c.access === "authenticated"),
  )("$endpoint", (testCase) => {
    it("refuses a caller with no session with 401", async () => {
      // The other half of the contract for a session-only endpoint: a session
      // is necessary. An endpoint documented as `authenticated` that answers an
      // anonymous caller is not doing anything, and this is the only assertion
      // in the suite that would notice.
      const refusal = await call(testCase.route, testCase.method);

      expect(refusal.status).toBe(401);
      expect(refusal.code).toBe("UNAUTHENTICATED");
    });
  });

  describe.each(
    CASES.filter((c) => c.access === "session-optional"),
  )("$endpoint", (testCase) => {
    it("answers an anonymous caller 200 rather than refusing", async () => {
      // Sign-out is idempotent by design: a button must not report an error to
      // somebody who is already signed out, and a 401 here would make the
      // endpoint a way to ask whether a given token is still live. Asserted
      // explicitly because it is the one endpoint where "no session" is a
      // success, and the sweep above would otherwise read it as a defect.
      const response = await call(testCase.route, testCase.method);

      expect(response.status).toBe(200);
    });
  });

  describe.each(
    CASES.filter((c) => c.access === "public"),
  )("$endpoint", (testCase) => {
    it("reaches its handler and refuses the empty body with 422", async () => {
      // The five public endpoints: register, login, forgot-password,
      // reset-password, verify-email. Public by design, so the assertion is
      // that the request gets *past* the guards and is then refused for the
      // payload — a `422 VALIDATION_FAILED` on a body with no fields.
      //
      // Pinning the status rather than merely ruling out 401 and 403 is what
      // makes this an assertion. "Not a refusal" is satisfied by a 500, and a
      // handler that crashes once the guards are gone is precisely the failure
      // the rest of this suite is built to notice.
      const refusal = await call(testCase.route, testCase.method);

      expect(refusal).toEqual({
        status: 422,
        code: "VALIDATION_FAILED",
      });
    });
  });
});
