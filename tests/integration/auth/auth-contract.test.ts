import {
  connectToDatabase,
  disconnectDatabase,
  envelope,
  ORIGIN,
  postJson,
  postRaw,
  resetAuthTables,
} from "@tests/support/auth-contract";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as forgotPassword } from "@/app/api/v1/auth/forgot-password/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as resetPassword } from "@/app/api/v1/auth/reset-password/route";
import { POST as verifyEmail } from "@/app/api/v1/auth/verify-email/route";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * The request and response contract the nine auth endpoints share.
 *
 * Body parsing, content type, unknown fields, the `Origin` check, and the shape
 * of a failure. None of it is specific to one endpoint, which is why it is three
 * representative handlers rather than nine repetitions of the same assertions:
 * the check lives in the wrapper and in `parseBody`, so testing it once per
 * place it is implemented is the coverage.
 */

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetAuthTables();
});

const ADA = { email: "ada@example.com", name: "Ada Lovelace" };
const PASSWORD = "correct horse battery staple";

describe("content type", () => {
  it("refuses a mutating request that is not JSON", async () => {
    // Before the body is parsed. A `text/plain` body is not a validation failure
    // of any field, it is the wrong kind of request, and it should say so rather
    // than reporting a missing field.
    const response = await register(
      postRaw("/register", {
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ ...ADA, password: PASSWORD }),
      }),
    );
    const body = await envelope(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("BAD_REQUEST");
    expect(body.error?.message).toMatch(/JSON/i);
  });
});

describe("malformed JSON", () => {
  it("answers 400 BAD_REQUEST, and does not claim a field is wrong", async () => {
    // 400 rather than 422, and separately from a validation failure. The body
    // could not be read, so no field was ever checked and reporting
    // "password is required" would be a lie about what happened.
    const response = await register(
      postRaw("/register", { body: "{ this is not json" }),
    );
    const body = await envelope(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("BAD_REQUEST");
    expect(body.error?.details).toBeUndefined();
  });
});

describe("validation", () => {
  it("answers 422 VALIDATION_FAILED with a detail per field", async () => {
    const response = await register(
      postJson("/register", { email: ADA.email }),
    );
    const body = await envelope(response);

    expect(response.status).toBe(422);
    expect(body.error?.code).toBe("VALIDATION_FAILED");
    const paths = body.error?.details?.map((detail) => detail.path) ?? [];
    // Every missing field at once. A form that only ever mentions one is a
    // miserable loop for whoever is filling it in.
    expect(paths).toContain("name");
    expect(paths).toContain("password");
  });

  it("rejects an unknown field rather than ignoring it", async () => {
    // `z.object` would strip it and answer 201, and the client would reasonably
    // conclude the field was accepted. Silently dropping a field is how a
    // `role: "OWNER"` in a registration body becomes a week of debugging.
    const response = await register(
      postJson("/register", {
        ...ADA,
        password: PASSWORD,
        emailVerified: true,
        role: "OWNER",
      }),
    );
    const body = await envelope(response);

    expect(response.status).toBe(422);
    expect(body.error?.code).toBe("VALIDATION_FAILED");
    expect(
      await import("@/modules/identity").then(({ UserModel }) =>
        UserModel.countDocuments({}),
      ),
    ).toBe(0);
  });

  it("reports the password policy in the message the user sees", async () => {
    const response = await register(
      postJson("/register", { ...ADA, password: "short" }),
    );
    const body = await envelope(response);

    expect(response.status).toBe(422);
    const detail = body.error?.details?.find(
      (item) => item.path === "password",
    );
    expect(detail?.message).toMatch(/12/);
  });
});

describe("the Origin check on the mounted routes", () => {
  // Every mutating handler, so a route that opted out of the wrapper would be
  // caught. The check itself is asserted exhaustively in
  // tests/unit/shared/with-api.test.ts; what is unique here is that these are
  // the *mounted* handlers.
  const routes: [string, (request: Request) => Promise<Response>][] = [
    ["/register", register],
    ["/login", login],
    ["/forgot-password", forgotPassword],
    ["/reset-password", resetPassword],
    ["/verify-email", verifyEmail],
  ];

  const crossOrigin = (route: string) =>
    new Request(`${ORIGIN}/api/v1/auth${route}`, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: ADA.email, password: PASSWORD }),
    });

  const noOrigin = (route: string) =>
    new Request(`${ORIGIN}/api/v1/auth${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ADA.email, password: PASSWORD }),
    });

  it("refuses every mutating auth route from another site", async () => {
    for (const [route, handler] of routes) {
      const response = await handler(crossOrigin(route));
      expect(response.status, route).toBe(403);
      expect((await envelope(response)).error?.code, route).toBe(
        "ORIGIN_NOT_ALLOWED",
      );
    }
  });

  it("refuses a mutating auth route with no Origin at all", async () => {
    // Fail closed. "No Origin" is the shape of a probe, and it is what a
    // non-browser client forgets.
    for (const [route, handler] of routes) {
      const response = await handler(noOrigin(route));
      expect(response.status, route).toBe(403);
    }
  });

  it("touches no data on a refused request", async () => {
    // The check runs before the body is read, so a cross-origin registration
    // cannot create an account even if the body is well formed.
    const { UserModel } = await import("@/modules/identity");

    await register(crossOrigin("/register"));

    expect(await UserModel.countDocuments({})).toBe(0);
  });
});

describe("the session cookie name", () => {
  it("is `bn_session`, read from the one module that defines it", async () => {
    // One constant, read by the proxy, the DAL, the cookie writer and these
    // tests. The name is a public contract — the proxy, the sign-in page and
    // any bookmarked session depend on it — so a rename is a change, and this
    // is the line that says so.
    expect(SESSION_COOKIE).toBe("bn_session");
  });
});
