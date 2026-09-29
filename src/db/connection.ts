import mongoose from "mongoose";
import { env, isProduction, isTest } from "@/env";

/**
 * The database connection.
 *
 * Deployed to Vercel, every serverless instance is a fresh container that lives
 * for a request or a few. A connection opened per invocation would spend most
 * of its life in DNS and TLS, and the instance would be killed with the socket
 * still open. So the client is created once per instance and reused, which
 * means the cache has to outlive module evaluation — hence `globalThis`, which
 * survives the hot-reload module graph re-creation that a plain module-level
 * variable does not.
 *
 * The cache holds the *promise*, not the resolved client, and that distinction
 * is the whole design. Caching the resolved value leaves a window between the
 * first caller starting `connect()` and the client resolving, during which
 * every other caller sees a cache miss and starts its own connection. Two
 * concurrent requests — the first request of a cold instance, which is exactly
 * when it happens — would open two clients and the instance would keep both for
 * its whole life. Caching the promise collapses that window to nothing.
 *
 * Pool sizing follows the serverless shape rather than a throughput
 * calculation: an instance handles a handful of concurrent requests and lives
 * briefly, so a large pool is connections held open by a process about to be
 * frozen. Five is the ceiling, and `minPoolSize: 0` means a cold instance opens
 * nothing until something actually queries.
 */

const POOL = {
  /**
   * At most a few requests run concurrently per instance, so a bigger pool only
   * buys idle sockets on a container that is about to be reclaimed.
   */
  maxPoolSize: 5,
  /** Nothing is opened speculatively; a cold instance costs nothing. */
  minPoolSize: 0,
  /** Release sockets promptly so a burst does not permanently inflate the pool. */
  maxIdleTimeMS: 30_000,
  /**
   * Fails fast when no server can be selected. Left generous in development
   * because a laptop waking from sleep needs longer than a data centre.
   */
  serverSelectionTimeoutMS: isProduction ? 5_000 : 15_000,
  connectTimeoutMS: 10_000,
  /**
   * Bounds a single operation. Without it a half-open socket to a database
   * that has gone away hangs the request until the platform kills the function.
   */
  socketTimeoutMS: 45_000,
  /**
   * The important one on serverless, and the only setting here that is a
   * deliberate change from the Mongoose default rather than a pool number.
   *
   * Measured against a server that accepts the socket and never completes the
   * handshake, with `serverSelectionTimeoutMS: 4000`:
   *
   *   bufferCommands: false -> the query rejects in 39ms
   *   default (buffering)   -> the query rejects in 10_025ms
   *
   * The buffered query does not give up when the connection attempt fails at
   * 4s. It waits out `bufferTimeoutMS`, which defaults to 10s, so the caller
   * sits through six seconds of dead air for an error that was available
   * immediately. On a platform whose own function timeout is in the same
   * range, the user gets a timeout rather than a message they can act on.
   *
   * Note that this only bites when the connection is mid-handshake, which is
   * exactly the cold-start window. Every handler is still expected to await
   * `connectToDatabase()`; this setting is what makes the mistake of forgetting
   * to fail loudly instead of failing quietly.
   */
  bufferCommands: false,
} as const;

interface ConnectionCache {
  /** Cached promise, so concurrent callers share one connection attempt. */
  connection?: Promise<typeof mongoose>;
}

const cache = globalThis as typeof globalThis & {
  __bizNexusDb?: ConnectionCache;
};

function getCache(): ConnectionCache {
  // Assigned rather than initialised as a literal so the object survives module
  // re-evaluation and still holds the promise created by the first one.
  cache.__bizNexusDb ??= {};
  return cache.__bizNexusDb;
}

/**
 * Resolve a connected Mongoose, reusing the instance's connection if there is
 * one. Safe to call from every request handler.
 *
 * Deliberately not `async`. An async function wraps its return value in a fresh
 * promise on every call, so each caller would receive a different promise object
 * even though they all awaited the same connection attempt. Returning the cached
 * promise itself makes "everyone shares one attempt" true by identity rather
 * than by inspection, and saves an allocation per request.
 */
export function connectToDatabase(): Promise<typeof mongoose> {
  const store = getCache();

  if (store.connection) return store.connection;

  store.connection = mongoose
    .connect(env.MONGODB_URI, POOL)
    .then((client) => {
      if (!isTest) {
        // The connection is the one thing whose loss explains every other
        // failure downstream, so it is worth a line in the log.
        console.info(`[db] connected to ${redact(env.MONGODB_URI)}`);
      }
      return client;
    })
    .catch((error: unknown) => {
      // Drop the rejected promise. Caching it would poison the instance: every
      // later request would await the same failure and none would ever retry,
      // so one unlucky cold start would take the instance down for its whole
      // life rather than for one request.
      store.connection = undefined;
      throw error;
    });

  return store.connection;
}

/** Test and shutdown hook. Production instances are reclaimed, not closed. */
export async function disconnectDatabase(): Promise<void> {
  const store = getCache();
  store.connection = undefined;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

/** True once a connection exists, for diagnostics and health checks. */
export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * The database name parsed from the URI, for log lines and test assertions.
 * Credentials never appear in a URL that reaches a log.
 */
function redact(uri: string): string {
  return uri.replace(/\/\/[^@/]*@/, "//***@");
}

export { redact as redactMongoUri };
export { POOL as connectionOptions };
