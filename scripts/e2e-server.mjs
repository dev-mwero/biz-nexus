import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { MongoMemoryReplSet } from "mongodb-memory-server";

/**
 * Boots the E2E web server against a throwaway MongoDB replica set.
 *
 * Playwright's `webServer` only knows how to run one command; it cannot start
 * a database, read the ephemeral URI that database chose, and then start the
 * app with that URI. Doing all three here is what makes the suite independent
 * of whatever is on the developer's machine.
 *
 * The database is a single-node replica set rather than a standalone `mongod`
 * because services use multi-document transactions (lead conversion writes a
 * contact, a company, a deal, and the lead atomically) and MongoDB only offers
 * those on a replica set. The developer's local `mongod` is usually a
 * standalone, which is why pointing E2E at it fails on registration with
 * "does not support retryable writes". Starting our own also means every run
 * begins from an empty database, so tests never see state left by a previous
 * run or by manual poking at the dev server.
 *
 * The system `mongod` binary is preferred over the downloader for the same
 * reasons the integration suite prefers it: no large download, no network
 * dependency, and no reliance on the downloader recognising the distro. The
 * download remains the fallback for a machine without `mongod` installed.
 */

const SYSTEM_BINARY_CANDIDATES = [
  process.env.MONGOMS_SYSTEM_BINARY,
  "/usr/bin/mongod",
  "/usr/local/bin/mongod",
  "/opt/homebrew/bin/mongod",
].filter(Boolean);

function findSystemBinary() {
  return SYSTEM_BINARY_CANDIDATES.find((path) => existsSync(path));
}

/**
 * Declaring the real version up front stops mongodb-memory-server from
 * comparing the system binary against the version it would have downloaded and
 * logging a conflict warning on every run.
 */
function readSystemBinaryVersion(binary) {
  try {
    const output = execFileSync(binary, ["--version"], { encoding: "utf8" });
    return output.match(/db version v(\d+\.\d+\.\d+)/)?.[1];
  } catch {
    return undefined;
  }
}

function mongoOptions() {
  const systemBinary = findSystemBinary();
  const systemVersion = systemBinary && readSystemBinaryVersion(systemBinary);
  return systemBinary
    ? { systemBinary, ...(systemVersion ? { version: systemVersion } : {}) }
    : {};
}

const replicaSet = await MongoMemoryReplSet.create({
  binary: mongoOptions(),
  replSet: { count: 1, storageEngine: "wiredTiger" },
  instanceOpts: [{ launchTimeout: 60_000 }],
});

const uri = replicaSet.getUri();
console.log(`[e2e] replica set ready at ${uri}`);

const server = spawn("node_modules/.bin/next", ["start"], {
  stdio: "inherit",
  env: { ...process.env, MONGODB_URI: uri },
});

let shuttingDown = false;

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.kill("SIGTERM");
  try {
    await replicaSet.stop();
  } catch {
    // Nothing useful to do if the in-memory database is already gone.
  }
  process.exit(code ?? 0);
}

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));
server.on("error", (error) => {
  console.error("[e2e] failed to start next:", error);
  void shutdown(1);
});
server.on("exit", (code) => void shutdown(code ?? 0));
