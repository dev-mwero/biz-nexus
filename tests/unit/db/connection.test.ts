import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase, redactMongoUri } from "@/db/connection";

/**
 * The acceptance criterion for this module is "two concurrent requests open one
 * connection", and the reason it is worth a test is that the obvious
 * implementation gets it wrong.
 *
 * Caching the resolved client instead of the promise leaves a window between
 * the first caller starting `connect()` and the client resolving, during which
 * every other caller sees a miss. The test below fires the callers
 * simultaneously rather than in sequence, so it lands inside that window.
 */

function clearConnectionCache() {
  const global = globalThis as typeof globalThis & {
    __bizNexusDb?: { connection?: Promise<typeof mongoose> };
  };
  global.__bizNexusDb = {};
}

describe("connectToDatabase", () => {
  beforeEach(() => {
    clearConnectionCache();
  });

  afterEach(() => {
    clearConnectionCache();
    vi.restoreAllMocks();
  });

  it("opens exactly one connection for many concurrent callers", async () => {
    const connect = vi
      .spyOn(mongoose, "connect")
      .mockResolvedValue(mongoose as unknown as typeof mongoose);

    // Fired in the same tick, so every call happens while the first is still
    // in flight. Sequential calls would pass even with a broken cache.
    const results = await Promise.all(
      Array.from({ length: 25 }, () => connectToDatabase()),
    );

    expect(connect).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result).toBe(mongoose);
    }
  });

  it("returns the same promise instance to every concurrent caller", async () => {
    vi.spyOn(mongoose, "connect").mockImplementation(
      () => new Promise(() => {}) as never,
    );

    const first = connectToDatabase();
    const second = connectToDatabase();

    expect(first).toBe(second);
  });

  it("reuses the connection on a later call", async () => {
    const connect = vi
      .spyOn(mongoose, "connect")
      .mockResolvedValue(mongoose as unknown as typeof mongoose);

    await connectToDatabase();
    await connectToDatabase();
    await connectToDatabase();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("configures the pool for the serverless shape", async () => {
    const connect = vi
      .spyOn(mongoose, "connect")
      .mockResolvedValue(mongoose as unknown as typeof mongoose);

    await connectToDatabase();

    const [, options] = connect.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(options.maxPoolSize).toBe(5);
    expect(options.minPoolSize).toBe(0);
    expect(options.maxIdleTimeMS).toBe(30_000);
    // The setting that turns a hang into an error.
    expect(options.bufferCommands).toBe(false);
    expect(options.socketTimeoutMS).toBeGreaterThan(0);
    expect(options.serverSelectionTimeoutMS).toBeGreaterThan(0);
  });

  it("passes the validated URI, never a hand-built one", async () => {
    const connect = vi
      .spyOn(mongoose, "connect")
      .mockResolvedValue(mongoose as unknown as typeof mongoose);

    await connectToDatabase();

    const [uri] = connect.mock.calls[0] as [string];
    expect(uri).toBe(process.env.MONGODB_URI);
    expect(uri.startsWith("mongodb")).toBe(true);
  });

  it("propagates a connection failure to every caller", async () => {
    vi.spyOn(mongoose, "connect").mockRejectedValue(
      new Error("connection refused"),
    );

    const results = await Promise.allSettled([
      connectToDatabase(),
      connectToDatabase(),
    ]);

    expect(results.every((r) => r.status === "rejected")).toBe(true);
  });

  it("clears the cache after a failure so a later call can retry", async () => {
    const connect = vi
      .spyOn(mongoose, "connect")
      .mockRejectedValueOnce(new Error("cold start raced"))
      .mockResolvedValue(mongoose as unknown as typeof mongoose);

    await expect(connectToDatabase()).rejects.toThrow("cold start raced");

    // Without the reset, the cached rejection would be handed to every
    // subsequent request and none of them would ever retry. One unlucky cold
    // start would disable the instance for its whole life.
    await expect(connectToDatabase()).resolves.toBe(mongoose);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("caches on globalThis so it survives module re-evaluation", async () => {
    const connect = vi
      .spyOn(mongoose, "connect")
      .mockResolvedValue(mongoose as unknown as typeof mongoose);

    await connectToDatabase();

    // Next replaces the module graph on every hot reload in development. If the
    // cache lived in a module-level variable, each reload would open a new
    // connection and the old ones would leak.
    vi.resetModules();
    const reloaded = await import("@/db/connection");
    await reloaded.connectToDatabase();

    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe("redactMongoUri", () => {
  it("removes credentials from a connection string", () => {
    const redacted = redactMongoUri(
      "mongodb+srv://user:secret@cluster.mongodb.net/db",
    );
    expect(redacted).not.toContain("secret");
    expect(redacted).toBe("mongodb+srv://***@cluster.mongodb.net/db");
  });

  it("leaves a credential-free string intact", () => {
    expect(redactMongoUri("mongodb://127.0.0.1:27017/biz_nexus")).toBe(
      "mongodb://127.0.0.1:27017/biz_nexus",
    );
  });
});
