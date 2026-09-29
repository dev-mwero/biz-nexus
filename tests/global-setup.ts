/**
 * Vitest global setup.
 *
 * Boots the in-memory MongoDB once per test run and hands the connection
 * string to every worker through `MONGODB_URI`.
 */

import { startTestDatabase, stopTestDatabase } from "./support/test-database";

let uri: string | undefined;

export async function setup(): Promise<void> {
  uri = await startTestDatabase();
  process.env.MONGODB_URI = uri;
  // NODE_ENV is not set here. Vitest already defaults it to "test", and Next's
  // types declare it readonly, so assigning it is both redundant and a type
  // error. Tests that need to exercise the production branch set it explicitly
  // for the duration of that one assertion.
}

export async function teardown(): Promise<void> {
  await stopTestDatabase();
}
