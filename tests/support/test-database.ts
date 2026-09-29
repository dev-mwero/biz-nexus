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

/**
 * Boots a single-node replica set and returns its connection string.
 * Idempotent: repeated calls within one process return the same instance.
 */
export async function startTestDatabase(): Promise<string> {
  if (replicaSet) {
    return replicaSet.getUri();
  }

  const systemBinary = findSystemBinary();
  const systemVersion = systemBinary && readSystemBinaryVersion(systemBinary);

  replicaSet = await MongoMemoryReplSet.create({
    binary: systemBinary
      ? { systemBinary, ...(systemVersion ? { version: systemVersion } : {}) }
      : {},
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  return replicaSet.getUri();
}

export async function stopTestDatabase(): Promise<void> {
  await replicaSet?.stop();
  replicaSet = undefined;
}
