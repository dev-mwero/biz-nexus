import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { MongoMemoryReplSet } from "mongodb-memory-server";

/**
 * In-memory MongoDB replica set for integration tests.
 *
 * A replica set rather than a standalone instance, because several services
 * need multi-document transactions and MongoDB only offers those on a replica
 * set. Lead conversion is the first: it writes a contact, possibly a company,
 * possibly a deal, and updates the lead, and a half-applied conversion is
 * corruption rather than an inconvenience.
 *
 * The system `mongod` binary is preferred over downloading one. Reasons, in
 * order: no ~100MB download on first run, no network dependency in CI, and no
 * dependence on the downloader recognising the host distro — which it does not
 * do on every distribution. The download remains the fallback so a fresh
 * checkout still works without a system binary.
 */

const SYSTEM_BINARY_CANDIDATES = [
  process.env.MONGOMS_SYSTEM_BINARY,
  "/usr/bin/mongod",
  "/usr/local/bin/mongod",
  "/opt/homebrew/bin/mongod",
].filter((candidate): candidate is string => Boolean(candidate));

export function findSystemBinary(): string | undefined {
  return SYSTEM_BINARY_CANDIDATES.find((path) => existsSync(path));
}

/**
 * Reads the system binary's version so it can be declared up front.
 *
 * Without this, mongodb-memory-server compares the system version against the
 * version it would have downloaded and logs a version-conflict warning on every
 * single test run. Declaring the real version makes the check pass honestly
 * rather than suppressing the log.
 */
function readSystemBinaryVersion(binary: string): string | undefined {
  try {
    const output = execFileSync(binary, ["--version"], { encoding: "utf8" });
    return output.match(/db version v(\d+\.\d+\.\d+)/)?.[1];
  } catch {
    return undefined;
  }
}

let replicaSet: MongoMemoryReplSet | undefined;

/** Apply one consistent system-binary selection to every in-memory server. */
export function createTestMongoOptions() {
  const systemBinary = findSystemBinary();
  const systemVersion = systemBinary && readSystemBinaryVersion(systemBinary);
  return {
    binary: systemBinary
      ? {
          systemBinary,
          ...(systemVersion ? { version: systemVersion } : {}),
        }
      : {},
  };
}

/**
 * Boots a single-node replica set and returns its connection string.
 * Idempotent: repeated calls within one process return the same instance.
 */
export async function startTestDatabase(): Promise<string> {
  if (replicaSet) {
    return replicaSet.getUri();
  }

  replicaSet = await MongoMemoryReplSet.create({
    binary: createTestMongoOptions().binary,
    replSet: { count: 1, storageEngine: "wiredTiger" },
    // Vitest starts one worker per test file, so with the auth contract suites
    // added this is several replica sets booting at once on the same machine.
    // mongodb-memory-server's default is 10s, which a cold download or a busy
    // disk overruns, and the failure it produces is a bare timeout with no
    // mention of which of the parallel boots ran out of time. 60s is generous
    // for a binary that is already cached and still short enough that a genuine
    // hang fails the run instead of stalling it.
    //
    // On `instanceOpts`, not at the top level. `MongoMemoryReplSetOpts` in
    // mongodb-memory-server 11.3.0 has only `instanceOpts`, `binary` and
    // `replSet`; `launchTimeout` hangs off `MongoMemoryInstanceOptsBase` and is
    // copied to each instance. A top-level `launchTimeout` is not rejected at
    // runtime — excess properties are simply ignored — so it would look like it
    // worked and change nothing.
    instanceOpts: [{ launchTimeout: 60_000 }],
  });

  return replicaSet.getUri();
}

export async function stopTestDatabase(): Promise<void> {
  await replicaSet?.stop();
  replicaSet = undefined;
}
