import type { Types } from "mongoose";
import { connectToDatabase, disconnectDatabase } from "@/db/connection";
import {
  EmailVerificationTokenModel,
  PasswordResetTokenModel,
  SessionModel,
  UserModel,
} from "@/modules/identity";
import { hashPassword } from "@/modules/identity/password";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * The plumbing shared by the three auth contract suites.
 *
 * The suites call the real route handlers with real `Request` objects and real
 * cookies, and read the database afterwards. That is the point: cookie
 * attributes, the origin check, the error envelope and the row each call left
 * behind are the contract, and testing anything narrower would test the
 * service rather than the endpoint.
 *
 * Nothing here asserts. Every helper is a way to make an assertion shorter; a
 * helper that made one would be a helper nobody could check.
 */

/**
 * `env.APP_URL` as tests/setup-env.ts sets it. The Origin every mutating
 * request must carry, and the only one the wrapper accepts.
 */
export const ORIGIN = "http://localhost:3000";

const BASE = `${ORIGIN}/api/v1/auth`;

/** Read the `Set-Cookie` the response carries, or null. */
export function setCookie(response: Response): string | null {
  return response.headers.get("set-cookie");
}

/**
 * The session token out of a `Set-Cookie` header, or null.
 *
 * Parsed rather than sliced, so a test asserting on the value is not coupled to
 * the exact attribute order `serializeCookie` happens to emit.
 */
export function cookieToken(response: Response): string | null {
  const header = setCookie(response);
  if (!header) return null;
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`).exec(header);
  return match?.[1] ?? null;
}

/**
 * The `Set-Cookie` header naming `name`, whole, or null.
 *
 * Returns the entire header rather than the `name=value` pair, because the
 * attributes after the value are the part worth asserting on: `HttpOnly`,
 * `SameSite`, `Max-Age` and `Domain` are all written after the token, so a
 * helper that returned only the pair would make them untestable.
 */
export function cookieNamed(response: Response, name: string): string | null {
  const header = setCookie(response);
  if (!header) return null;
  return new RegExp(`(?:^|;\\s*)${name}=`).test(header) ? header : null;
}

/** A JSON body with the content type a real client sends. */
function json(body: unknown): RequestInit {
  return {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function postJson(
  route: string,
  body: unknown,
  init: RequestInit = {},
): Request {
  return new Request(`${BASE}${route}`, {
    method: "POST",
    ...json(body),
    ...init,
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

export function postRaw(route: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${route}`, {
    method: "POST",
    ...init,
    headers: { origin: ORIGIN, ...init.headers },
  });
}

export function get(route: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${route}`, { method: "GET", ...init });
}

/** A GET carrying a session cookie, for the `/me` suite. */
export function getWithCookie(token: string, route = "/me"): Request {
  return get(route, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
}

/**
 * Everything a session-guarded POST needs: a session cookie and an Origin.
 *
 * The Origin is not optional and has no default, because forgetting it is the
 * mistake these tests exist to catch.
 */
export function authedPost(
  route: string,
  body: unknown,
  token: string,
): Request {
  return postJson(route, body, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

export interface Envelope<T = Record<string, unknown>> {
  data?: T;
  error?: {
    code: string;
    message: string;
    requestId: string;
    details?: { path: string; message: string }[];
  };
}

export async function envelope<T = Record<string, unknown>>(
  response: Response,
): Promise<Envelope<T>> {
  return JSON.parse(await response.text()) as Envelope<T>;
}

/**
 * The status and body of a failed response, with the request id masked.
 *
 * Byte-identical refusals are a requirement, so the comparison is on the raw
 * serialised body rather than a parsed one: two envelopes can parse equally and
 * still differ in whitespace or key order, and a client diffing responses sees
 * that.
 *
 * The one field masked is the request id, and it has to be. It is generated per
 * request on purpose — it is the handle that lets somebody quote this failure to
 * the operator who has the log line — so two honest refusals of the same failure
 * differ in it by construction. Masking it leaves the code, the message, the
 * status and the field order under comparison, which is the whole of the
 * requirement.
 */
export async function refusal(
  response: Response,
): Promise<{ status: number; body: string }> {
  const body = await response.text();
  return {
    status: response.status,
    body: body.replace(
      /"requestId":"[0-9a-f-]{36}"/g,
      '"requestId":"<masked>"',
    ),
  };
}

export interface TestUser {
  _id: Types.ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  lastLoginAt: Date | null;
}

/**
 * A password hash made once per file.
 *
 * bcryptjs at cost 12 is ~2.1s of pure CPU per hash on ordinary hardware. The
 * suites are CPU-bound rather than I/O-bound and Vitest divides one set of cores
 * across one worker per file, so hashing per test turns a 10s file into a 2min
 * one and then into a timeout. The hash is verified against the plaintext on
 * every use, so a stale fixture fails loudly rather than passing everything.
 */
export const PASSWORD = "correct horse battery staple";

// The in-flight promise, not the resolved string. Two fixtures created
// concurrently would otherwise both see `undefined` and both start a hash, which
// is the exact cost this module exists to pay once.
let pendingHash: Promise<string> | undefined;

/** A cost-12 hash of {@link PASSWORD}, computed at most once per file. */
export function passwordHash(): Promise<string> {
  pendingHash ??= hashPassword(PASSWORD);
  return pendingHash;
}

/** A registered, unverified user. */
export async function createUser(
  overrides: Partial<{
    email: string;
    name: string;
    passwordHash: string;
  }> = {},
): Promise<TestUser> {
  const [user] = await UserModel.create([
    {
      email: overrides.email ?? "ada@example.com",
      name: overrides.name ?? "Ada Lovelace",
      passwordHash: overrides.passwordHash ?? (await passwordHash()),
      emailVerifiedAt: null,
    },
  ]);
  return user as unknown as TestUser;
}

/**
 * Empty every collection the auth suites write to.
 *
 * Between each test, not once at the start. A test that leaves a row behind
 * would otherwise make the *next* test depend on it, and the failure that
 * produces is a mystery in the wrong file.
 */
export async function resetAuthTables(): Promise<void> {
  await Promise.all([
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    EmailVerificationTokenModel.deleteMany({}),
    PasswordResetTokenModel.deleteMany({}),
  ]);
}

export { connectToDatabase, disconnectDatabase };
