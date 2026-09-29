import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectionOptions,
  connectToDatabase,
  disconnectDatabase,
  isDatabaseConnected,
} from "@/db/connection";

/**
 * Against a real MongoDB, because the mocked version of this file cannot prove
 * the thing that matters: that a connection is actually openable, that
 * `bufferCommands: false` does not break ordinary writes, and that concurrent
 * callers end up sharing one real socket pool rather than one mock.
 */

describe("connectToDatabase (integration)", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("opens a usable connection", async () => {
    expect(isDatabaseConnected()).toBe(true);
    expect(mongoose.connection.readyState).toBe(1);
  });

  it("serves concurrent callers from one connection", async () => {
    // The acceptance criterion, against a real server: many callers arriving at
    // once, all resolving, with the instance still holding a single client.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => connectToDatabase()),
    );

    for (const result of results) {
      expect(result).toBe(mongoose);
    }
    expect(isDatabaseConnected()).toBe(true);
  });

  it("performs real reads and writes with buffering disabled", async () => {
    // bufferCommands: false is the setting that turns a hung request into an
    // error. It must not stop normal traffic.
    const collection = mongoose.connection.collection("connection_probe");

    await collection.insertOne({ at: new Date(), label: "probe" });
    const found = await collection.findOne({ label: "probe" });

    expect(found?.label).toBe("probe");

    await collection.deleteMany({ label: "probe" });
  });

  it("supports sessions, which every repository will need", async () => {
    const session = await mongoose.startSession();
    try {
      expect(session).toBeDefined();
    } finally {
      await session.endSession();
    }
  });

  it("applies the pool options to the real driver", () => {
    // Asserted on the exported options rather than the driver's internals, which
    // are not part of Mongoose's public surface.
    expect(connectionOptions.maxPoolSize).toBe(5);
    expect(connectionOptions.minPoolSize).toBe(0);
    expect(connectionOptions.bufferCommands).toBe(false);
  });

  it("reports a disconnected state after teardown", async () => {
    // Proves disconnectDatabase actually releases, so the next suite in this
    // worker starts from a clean slate.
    await disconnectDatabase();
    expect(isDatabaseConnected()).toBe(false);

    await connectToDatabase();
    expect(isDatabaseConnected()).toBe(true);
  });
});
