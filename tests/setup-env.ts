import { existsSync } from "node:fs";

/**
 * Per-file test setup.
 *
 * Environment values that the application validates at boot. Test
 * environments must be self-contained: a suite that cannot run because a
 * developer's local .env is missing or stale is a suite that gets skipped.
 *
 * NODE_ENV is omitted because Vitest already sets it to "test".
 *
 * The production guard in src/env.ts deliberately refuses placeholder secrets
 * when NODE_ENV is "production". NODE_ENV is "test" here, so the placeholder
 * below is accepted — and that is the point: the guard is real, and the tests
 * that assert it flip NODE_ENV themselves.
 */

process.env.APP_NAME = "BizNexus Test";
process.env.APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-bytes-long";
process.env.MAIL_DRIVER = "console";
process.env.MAIL_FROM = "BizNexus Test <no-reply@test.local>";
process.env.RATELIMIT_DRIVER = "memory";

// Deepin is not recognised by mongodb-memory-server's distro detector. Prefer
// an installed mongod where available; this also avoids downloading a binary in
// offline development and CI environments.
const systemMongoBinary =
  process.env.MONGOMS_SYSTEM_BINARY ?? "/usr/bin/mongod";
if (existsSync(systemMongoBinary)) {
  process.env.MONGOMS_SYSTEM_BINARY = systemMongoBinary;
}

// MONGODB_URI is set by tests/global-setup.ts and deliberately not defaulted
// here. A missing value should fail loudly rather than silently connect to a
// developer's real database.

/**
 * Give this test file its own database on the shared in-memory replica set.
 *
 * Vitest runs test files in parallel workers against one server, and every
 * integration file ends with `deleteMany({})`. Sharing a database therefore
 * means one file's cleanup can wipe another's rows mid-test: failures that pass
 * in isolation and appear only in the full run, which is a false signal in both
 * directions and expensive to chase.
 *
 * Separate collections would work too, but a per-file database is what
 * docs/ARCHITECTURE.md specifies for integration suites, and it needs no
 * changes to the models.
 *
 * Named from the pid plus random bytes, so it is unique however the pool is
 * configured: with one worker per file the pid alone would do, but a shared
 * worker across files would collide.
 */
function withDatabase(uri: string, name: string): string {
  const [base, query] = uri.split("?");
  const withoutDatabase = base.replace(/\/[^/]*$/, "");
  return `${withoutDatabase}/${name}${query ? `?${query}` : ""}`;
}

const baseUri = process.env.MONGODB_URI;
if (!baseUri) {
  throw new Error(
    "MONGODB_URI was not set. tests/global-setup.ts must run before this file.",
  );
}

process.env.MONGODB_URI = withDatabase(
  baseUri,
  `test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`,
);
