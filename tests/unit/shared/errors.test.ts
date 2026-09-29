import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SlugConflictError } from "@/db/mixins/slug";
import { ActiveOrganizationError } from "@/modules/organizations/active-organization";
import { InvitationError } from "@/modules/organizations/invitation.service";
import { MembershipError } from "@/modules/organizations/membership.service";
import { OrganizationCreationError } from "@/modules/organizations/organization.service";
import { RoleProvisioningError } from "@/modules/rbac/role.service";
import { AuthError } from "@/shared/auth/dal";
import {
  AppError,
  ERROR_CATALOGUE,
  type ErrorCode,
  isAppError,
  isErrorCode,
  statusForCode,
  toErrorPayload,
  toErrorStatus,
} from "@/shared/errors/app-error";
import { fail, ok, pageMeta, statusOf } from "@/shared/responses/envelope";

/**
 * The error contract.
 *
 * Two properties matter more than the table's contents. The first is that the
 * codes in the catalogue are the only ones the client sees. The second is that
 * nothing unrecognised gets to say anything - which is a security property, and
 * the reason half of these tests are adversarial rather than descriptive.
 */

describe("the catalogue", () => {
  it("gives every code a status and a message", () => {
    for (const [code, definition] of Object.entries(ERROR_CATALOGUE)) {
      expect(definition.status, code).toBeGreaterThanOrEqual(400);
      expect(definition.status, code).toBeLessThan(600);
      expect(definition.message.length, code).toBeGreaterThan(0);
    }
  });

  it("never exposes an internal message", () => {
    // The `expose` flag is the mechanism, and a false value with a useful
    // message is a contradiction that would be easy to write by accident.
    for (const [code, definition] of Object.entries(ERROR_CATALOGUE)) {
      if (definition.expose) continue;
      expect(definition.message, code).toBe(ERROR_CATALOGUE.INTERNAL.message);
    }
  });

  it("keeps secrets out of every message", () => {
    // Messages ship to clients. The catalogue is the one place they are
    // written, so this is the only place a leak has to be caught.
    const forbidden = [
      /mongodb?:\/\//i,
      /mongoerr/i,
      /e11000/i,
      /duplicate key/i,
      /\bstack\b/i,
      /\/home\/|\/Users\/|[A-Z]:\\\\/,
      /password|secret|token|apikey/i,
    ];
    for (const [code, definition] of Object.entries(ERROR_CATALOGUE)) {
      for (const pattern of forbidden) {
        expect(definition.message, `${code} matches ${pattern}`).not.toMatch(
          pattern,
        );
      }
    }
  });

  it("uses a 404 for anything that could otherwise confirm existence", () => {
    // The rule from docs/ARCHITECTURE.md: a record in another tenant is 404,
    // never 403. A 403 confirms the record exists, and that difference is the
    // whole of the enumeration attack.
    const existenceRevealing: ErrorCode[] = [
      "RECORD_NOT_FOUND",
      "ORGANIZATION_UNAVAILABLE",
      "INVITATION_INVALID",
      "MEMBERSHIP_NOT_FOUND",
    ];
    for (const code of existenceRevealing) {
      expect(ERROR_CATALOGUE[code].status, code).toBe(404);
    }
  });

  it("uses 403 only for permissions and membership state", () => {
    const forbidden: ErrorCode[] = [
      "INSUFFICIENT_PERMISSION",
      "ACTIVE_ORGANIZATION_REQUIRED",
      "MEMBERSHIP_INACTIVE",
    ];
    for (const code of forbidden) {
      expect(ERROR_CATALOGUE[code].status, code).toBe(403);
    }
  });

  it("keeps expired and spent invitations at 410, not 404", () => {
    // A 410 tells the client not to offer to resend, which a 404 does not.
    // Not a 409 either: nothing is conflicting, the invitation is finished.
    for (const code of [
      "INVITATION_EXPIRED",
      "INVITATION_USED",
      "INVITATION_REVOKED",
    ] as const) {
      expect(ERROR_CATALOGUE[code].status, code).toBe(410);
    }
  });

  it("recognises a code only if it is in the table", () => {
    expect(isErrorCode("RECORD_NOT_FOUND")).toBe(true);
    expect(isErrorCode("DEAL_NOT_FOUND")).toBe(false);
    expect(isErrorCode("")).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(404)).toBe(false);
  });

  it("falls back to 500 for an unknown code rather than trusting it", () => {
    // A code arriving from a store we do not control is not a status we have
    // agreed to serve.
    expect(statusForCode("ATTACKER_CHOSEN_CODE")).toBe(500);
  });
});

describe("AppError", () => {
  it("takes its status from the table, not from the caller", () => {
    expect(new AppError("RECORD_NOT_FOUND").status).toBe(404);
    expect(new AppError("VALIDATION_FAILED").status).toBe(422);
    // There is no way to ask for a 200, or a 500 for a validation failure,
    // because nothing in the constructor accepts one.
  });

  it("keeps its code, message, and cause", () => {
    const cause = new Error("underlying");
    const error = new AppError("INTERNAL", {
      cause,
      internal: "driver said no",
    });

    expect(error.code).toBe("INTERNAL");
    expect(error.cause).toBe(cause);
    expect(error.internal).toBe("driver said no");
    expect(error).toBeInstanceOf(Error);
    expect(isAppError(error)).toBe(true);
  });

  it("uses the catalogue message by default", () => {
    expect(new AppError("EMAIL_ALREADY_REGISTERED").message).toMatch(
      /already/i,
    );
  });

  it("allows a clearer message for the same code", () => {
    const error = new AppError("RECORD_NOT_FOUND", {
      message: "Deal not found.",
    });
    expect(error.status).toBe(404);
    expect(error.message).toBe("Deal not found.");
  });

  it("builds the common shapes without a status argument", () => {
    expect(AppError.unauthorized().status).toBe(401);
    expect(AppError.forbidden().status).toBe(403);
    expect(AppError.notFound().status).toBe(404);
    expect(AppError.notFound("ORGANIZATION_UNAVAILABLE").code).toBe(
      "ORGANIZATION_UNAVAILABLE",
    );
    expect(AppError.conflict("SLUG_CONFLICT").status).toBe(409);
    expect(AppError.internal("a driver blew up").status).toBe(500);
  });

  it("keeps field details in order and attached to the code", () => {
    const error = AppError.validation([
      { path: "name", message: "Required" },
      { path: "email", message: "Invalid email" },
    ]);

    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.details).toHaveLength(2);
    expect(error.details?.[0]?.path).toBe("name");
  });

  it("refuses a code that is not in the table", () => {
    // Compile-time enforced; this is the runtime half for values that reached
    // us from outside TypeScript.
    // @ts-expect-error - deliberately outside ErrorCode
    expect(() => new AppError("NOT_A_REAL_CODE").status).not.toThrow();
    expect(new AppError("NOT_A_REAL_CODE" as ErrorCode).status).toBe(500);
  });
});

describe("normalising anything thrown", () => {
  it("passes an AppError through with its code and details", () => {
    const payload = toErrorPayload(
      AppError.validation([{ path: "email", message: "Invalid email" }]),
    );

    expect(payload).toEqual({
      code: "VALIDATION_FAILED",
      message: ERROR_CATALOGUE.VALIDATION_FAILED.message,
      details: [{ path: "email", message: "Invalid email" }],
    });
  });

  it("replaces the message of a non-exposed code", () => {
    const payload = toErrorPayload(
      new AppError("DATABASE_ERROR", {
        message: "conn refused to 10.0.0.4:27017",
      }),
    );

    expect(payload.message).toBe("Something went wrong.");
    expect(payload.message).not.toMatch(/10\.0\.0\.4/);
  });

  it("keeps a plain Error's message off the client", () => {
    // The default arm. A bare `new Error` from three layers down must not
    // become a response body.
    const payload = toErrorPayload(new Error("ECONNREFUSED 10.0.0.4:27017"));

    expect(payload).toEqual({
      code: "INTERNAL",
      message: "Something went wrong.",
    });
  });

  it("does not leak a Mongo duplicate-key error", () => {
    // The single most likely real leak: a driver error caught nowhere near a
    // route handler, carrying the collection name and both conflicting values.
    const driver = Object.assign(
      new Error(
        "E11000 duplicate key error collection: biznexus.memberships index: organizationId_1_userId_1 dup key: { organizationId: ObjectId('64f…'), userId: ObjectId('64e…') }",
      ),
      { name: "MongoServerError", code: 11000 },
    );

    const payload = toErrorPayload(driver);
    const serialised = JSON.stringify(payload);

    expect(payload.code).toBe("INTERNAL");
    expect(serialised).not.toMatch(/E11000/);
    expect(serialised).not.toMatch(/memberships/);
    expect(serialised).not.toMatch(/64f/);
  });

  it("does not let a thrown object posing as an error set its own code", () => {
    // Not `instanceof Error`, and carrying a code that is in the catalogue. A
    // guard that trusted either property would hand back this message.
    const imposter = { code: "RECORD_NOT_FOUND", message: "org 64f… exists" };

    expect(toErrorPayload(imposter)).toEqual({
      code: "INTERNAL",
      message: "Something went wrong.",
    });
  });

  it("does not let a subclass spoof a status", () => {
    // A class extending Error with a `status` property and an error-shaped
    // message. Only AppError gets to choose a status.
    class Sneaky extends Error {
      readonly status = 200;
      readonly code = "RECORD_NOT_FOUND";
    }
    const error = new Sneaky("org 64f… exists");

    expect(toErrorStatus(error)).toBe(500);
    expect(JSON.stringify(toErrorPayload(error))).not.toMatch(/64f/);
  });

  it("handles the non-Error values that really get thrown", () => {
    for (const thrown of [
      undefined,
      null,
      "a string",
      42,
      [],
      { nested: { deep: true } },
    ]) {
      expect(toErrorPayload(thrown)).toEqual({
        code: "INTERNAL",
        message: "Something went wrong.",
      });
      expect(toErrorStatus(thrown)).toBe(500);
    }
  });

  it("omits details entirely when there are none", () => {
    expect(toErrorPayload(AppError.notFound())).not.toHaveProperty("details");
    expect(toErrorPayload(AppError.validation([]))).not.toHaveProperty(
      "details",
    );
  });
});

describe("the envelopes", () => {
  it("wraps success as data, and omits meta when there is none", () => {
    expect(ok({ id: "1" })).toEqual({ data: { id: "1" } });
    expect(ok([1, 2])).toEqual({ data: [1, 2] });
    expect(Object.keys(ok("x"))).toEqual(["data"]);
  });

  it("carries meta alongside data", () => {
    expect(ok("x", { total: 3 })).toEqual({ data: "x", meta: { total: 3 } });
  });

  it("carries a falsy payload without inventing one", () => {
    // `ok(null)`, `ok(0)`, `ok("")` are all real responses. A wrapper that
    // treats them as "nothing to send" is how an empty list becomes a 200 with
    // no body.
    expect(ok(null)).toEqual({ data: null });
    expect(ok(0)).toEqual({ data: 0 });
    expect(ok("")).toEqual({ data: "" });
    expect(ok(false)).toEqual({ data: false });
  });

  it("never returns both data and error", () => {
    const success = ok("x");
    const failure = fail(AppError.notFound());

    expect(success).not.toHaveProperty("error");
    expect(failure).not.toHaveProperty("data");
  });

  it("wraps failure as error with the code and message", () => {
    expect(fail(AppError.notFound())).toEqual({
      error: { code: "RECORD_NOT_FOUND", message: "Not found." },
    });
  });

  it("attaches the request id when given one", () => {
    const envelope = fail(AppError.forbidden(), "01JBX7QK2M9");

    expect(envelope.error.requestId).toBe("01JBX7QK2M9");
    expect(envelope.error.code).toBe("INSUFFICIENT_PERMISSION");
  });

  it("omits the request id when there is none", () => {
    // A literal `undefined` would serialise away, but a key present with an
    // undefined value trips strict equality checks in contract tests.
    expect(Object.keys(fail(AppError.forbidden()).error)).toEqual([
      "code",
      "message",
    ]);
  });

  it("gives an unexpected throw a generic envelope", () => {
    expect(fail(new TypeError("x.map is not a function"))).toEqual({
      error: { code: "INTERNAL", message: "Something went wrong." },
    });
  });

  it("keeps validation details for the client to render", () => {
    const envelope = fail(
      AppError.validation([
        { path: "name", message: "Required" },
        { path: "email", message: "Invalid email" },
      ]),
    );

    expect(envelope.error.details).toEqual([
      { path: "name", message: "Required" },
      { path: "email", message: "Invalid email" },
    ]);
  });

  it("survives serialisation with no undefined keys and no Error objects", () => {
    // Contract tests compare parsed JSON, so a key that vanishes on
    // serialisation is a difference between what the test sees and what a
    // client sees.
    for (const envelope of [
      ok({ a: 1 }),
      fail(AppError.notFound()),
      fail(AppError.validation([{ path: "a", message: "b" }]), "req-1"),
    ]) {
      const round = JSON.parse(JSON.stringify(envelope));
      expect(round).toEqual(envelope);
    }
  });

  it("reports the status beside the envelope", () => {
    expect(statusOf(AppError.notFound())).toBe(404);
    expect(statusOf(AppError.validation([]))).toBe(422);
    expect(statusOf(new Error("boom"))).toBe(500);
  });
});

describe("paging metadata", () => {
  it("computes total pages", () => {
    expect(pageMeta({ page: 1, pageSize: 20, total: 137 })).toEqual({
      page: 1,
      pageSize: 20,
      total: 137,
      totalPages: 7,
    });
  });

  it("reports zero pages for an empty result", () => {
    // Not one empty page, and not a fraction.
    expect(pageMeta({ page: 1, pageSize: 20, total: 0 })).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it("rounds a partial last page up", () => {
    expect(pageMeta({ page: 1, pageSize: 20, total: 121 }).totalPages).toBe(7);
    expect(pageMeta({ page: 1, pageSize: 20, total: 120 }).totalPages).toBe(6);
    expect(pageMeta({ page: 1, pageSize: 20, total: 1 }).totalPages).toBe(1);
  });

  it("clamps nonsense rather than emitting NaN", () => {
    // The query has already run by the time this is called, so a bad page
    // number has already cost a round trip. Returning NaN in the body makes
    // the client fail later and further away.
    const meta = pageMeta({ page: 0, pageSize: 0, total: -5 });
    expect(meta.page).toBe(1);
    expect(meta.pageSize).toBe(1);
    expect(meta.total).toBe(0);
    expect(meta.totalPages).toBe(0);
    expect(JSON.stringify(meta)).not.toMatch(/NaN|null/);
  });

  it("truncates fractional input", () => {
    expect(pageMeta({ page: 2.9, pageSize: 20.5, total: 100.7 })).toEqual({
      page: 2,
      pageSize: 20,
      total: 100,
      totalPages: 5,
    });
  });

  it("keeps the last page addressable when asked for past the end", () => {
    // Clamping the page number would be wrong: the client is owed the truth
    // about which page it got.
    expect(pageMeta({ page: 99, pageSize: 20, total: 137 }).page).toBe(99);
  });
});

describe("the errors the application already throws", () => {
  /**
   * The point of the taxonomy is that these map without a per-route switch.
   * Before it, every handler needed to know about every error class in the
   * codebase, and any class it did not know about became a 500. These cases
   * fail the moment a class is added without a code, which is the moment the
   * switch starts growing again.
   */
  const existing: Array<[string, Error, ErrorCode, number]> = [
    [
      "ActiveOrganizationError",
      new ActiveOrganizationError(),
      "ORGANIZATION_UNAVAILABLE",
      404,
    ],
    [
      "OrganizationCreationError",
      new OrganizationCreationError("No such owner."),
      "ORGANIZATION_CREATION_FAILED",
      409,
    ],
    [
      "RoleProvisioningError",
      new RoleProvisioningError("Already provisioned."),
      "ROLE_PROVISIONING_FAILED",
      409,
    ],
    [
      "SlugConflictError",
      new SlugConflictError("acme", 5),
      "SLUG_CONFLICT",
      409,
    ],
    [
      "InvitationError (expired)",
      new InvitationError("INVITATION_EXPIRED", "This invitation has expired."),
      "INVITATION_EXPIRED",
      410,
    ],
    [
      "InvitationError (used)",
      new InvitationError("INVITATION_USED", "Already used."),
      "INVITATION_USED",
      410,
    ],
    [
      "InvitationError (foreign role)",
      new InvitationError(
        "ROLE_NOT_IN_ORGANIZATION",
        "That role is not available for this organization.",
      ),
      "ROLE_NOT_IN_ORGANIZATION",
      422,
    ],
    [
      "MembershipError (last owner)",
      new MembershipError("OWNER_REQUIRED", "This is the only active owner."),
      "OWNER_REQUIRED",
      409,
    ],
    [
      "AuthError (unauthenticated)",
      new AuthError("UNAUTHENTICATED", "Sign in to continue."),
      "UNAUTHENTICATED",
      401,
    ],
    [
      "AuthError (forbidden)",
      new AuthError("INSUFFICIENT_PERMISSION", "Not permitted."),
      "INSUFFICIENT_PERMISSION",
      403,
    ],
  ];

  it.each(
    existing,
  )("%s is an AppError with its catalogue code and status", (_name, error, code, status) => {
    expect(isAppError(error), _name).toBe(true);
    expect((error as AppError).code).toBe(code);
    expect((error as AppError).status).toBe(status);
    expect(toErrorStatus(error)).toBe(status);
    expect(toErrorPayload(error).code).toBe(code);
    expect(fail(error).error.code).toBe(code);
  });

  it.each(existing)("%s keeps its own class and name", (_name, error) => {
    // Existing call sites catch these by class, and the tests above rely on
    // it. The taxonomy must not flatten them.
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe(
      _name.split(" ")[0]?.replace("Error", "Error"),
    );
  });

  it("gives every error the application throws a code in the catalogue", () => {
    // The invariant, stated once. A code outside the table would silently fall
    // back to 500 and stop being a 404, which is the leak the table prevents.
    for (const [, error] of existing) {
      const code = (error as AppError).code;
      expect(isErrorCode(code), code).toBe(true);
      expect(
        ERROR_CATALOGUE[code as ErrorCode].status,
        `${code} status came from the table`,
      ).toBe((error as AppError).status);
    }
  });

  it("answers 404, not 403, for an organization the caller cannot see", () => {
    // The cross-tenant rule, on the error that actually reaches a handler. A
    // 403 here would confirm the organization exists somewhere.
    const error = new ActiveOrganizationError();

    expect(statusOf(error)).toBe(404);
    expect(fail(error).error).toEqual({
      code: "ORGANIZATION_UNAVAILABLE",
      message: "Organization not found.",
    });
  });

  it("does not confirm that a foreign role exists", () => {
    const error = new InvitationError(
      "ROLE_NOT_IN_ORGANIZATION",
      "That role is not available for this organization.",
    );

    // The catalogue message is the one that ships, and it says "not available"
    // rather than "belongs to another organization".
    expect(ERROR_CATALOGUE.ROLE_NOT_IN_ORGANIZATION.message).toMatch(
      /not available/,
    );
    expect(toErrorPayload(error).message).toBe(
      ERROR_CATALOGUE.ROLE_NOT_IN_ORGANIZATION.message,
    );
  });

  it("keeps an error's own message, since these are written for clients", () => {
    // These domain messages were written to be read by a user, which is the
    // opposite of the default arm. If a class is marked expose: false by
    // accident, its message stops shipping and this fails.
    expect(
      toErrorPayload(
        new OrganizationCreationError("That organization already exists."),
      ).message,
    ).toBe("That organization already exists.");
    expect(
      toErrorPayload(new ActiveOrganizationError("Organization not found."))
        .message,
    ).toBe("Organization not found.");
  });
});

describe("documentation", () => {
  it("docs/API.md lists exactly the catalogue's codes and statuses", () => {
    // The two disagreed once already, and in the more expensive direction:
    // API.md prescribed a generic vocabulary (NOT_FOUND, FORBIDDEN, CONFLICT)
    // that the implementation did not use, so the published contract was a
    // description of an API that did not exist. A test is cheaper than
    // discovering that from a client's error handling.
    const doc = readFileSync("docs/API.md", "utf8");
    const block =
      doc
        .split("The single source of truth is `ERROR_CATALOGUE`")[1]
        ?.split("```")[0] ?? "";

    const listed = [...block.matchAll(/^\| (\d{3}) \| `([A-Z_]+)` \|/gm)].map(
      ([, status, code]) => `${status} ${code}`,
    );
    const actual = Object.entries(ERROR_CATALOGUE).map(
      ([code, definition]) => `${definition.status} ${code}`,
    );

    expect(listed.sort()).toEqual(actual.sort());
  });

  it("docs/API.md's example envelope uses a real code and message", () => {
    // The worked example is what a client copies. If it names a code that is
    // not in the table, the table is not what anybody is actually using.
    const doc = readFileSync("docs/API.md", "utf8");
    const block = doc.split("**Failure**")[1]?.split("```")[1] ?? "";
    const code = block.match(/"code": "([A-Z_]+)"/)?.[1];
    const message = block.match(/"message": "([^"]+)"/)?.[1];

    expect(isErrorCode(code)).toBe(true);
    expect(ERROR_CATALOGUE[code as ErrorCode].status).toBe(422);
    expect(message).toBe(ERROR_CATALOGUE.VALIDATION_FAILED.message);
  });

  it("keeps the example's requestId the same shape the wrapper generates", () => {
    // Guarded loosely on purpose: the id is a correlation handle, not a
    // contract, so this checks the shape rather than pinning the value.
    const doc = readFileSync("docs/API.md", "utf8");
    const example = doc.match(/"requestId": "([^"]+)"/)?.[1] ?? "";

    expect(example).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("keeps every code in the ENTITY_THEN_CONDITION style", () => {
    // No verbs, and an entity before the condition. A code that reads as an
    // instruction stops making sense the moment it is quoted in a bug report,
    // which is exactly what `requestId` invites people to do.
    //
    // Two codes are exempt, and deliberately: `UNAUTHENTICATED` and `INTERNAL`
    // are the HTTP semantic every framework, proxy, and client already
    // recognises. Renaming them to `SESSION_MISSING` and `SERVER_FAULT` for the
    // sake of a pattern would make the API less legible, not more consistent.
    const ENTITY_LESS = new Set(["UNAUTHENTICATED", "INTERNAL"]);
    const verbs = /\b(GET|SET|DO|TRY|USE|MAKE|SEND|CHECK|VERIFY|THROW|RAISE)\b/;

    for (const code of Object.keys(ERROR_CATALOGUE)) {
      expect(code, `${code} reads as an instruction`).not.toMatch(verbs);
      expect(code, `${code} is not upper snake case`).toMatch(/^[A-Z][A-Z_]*$/);
      if (ENTITY_LESS.has(code)) continue;
      expect(code, `${code} needs an entity before the condition`).toMatch(
        /^[A-Z]+(_[A-Z]+)+$/,
      );
    }
  });

  it("exempts only the two codes the style check names", () => {
    // Otherwise the exception above could quietly grow.
    const singleWord = Object.keys(ERROR_CATALOGUE).filter(
      (code) => !code.includes("_"),
    );
    expect(singleWord.sort()).toEqual(["INTERNAL", "UNAUTHENTICATED"]);
  });
});
