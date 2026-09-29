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

// MONGODB_URI is set by tests/global-setup.ts and deliberately not defaulted
// here. A missing value should fail loudly rather than silently connect to a
// developer's real database.
