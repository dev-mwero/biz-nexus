import { MongoClient } from "mongodb";
import { describe, expect, it } from "vitest";

/**
 * The test harness verifying itself.
 *
 * Worth having explicitly: several services depend on multi-document
 * transactions, and MongoDB only provides those on a replica set. If the
 * harness silently degrades to a standalone instance, every test still passes
 * while the transaction paths are never actually exercised.
 */

describe("test harness", () => {
  it("boots the in-memory database and exposes it as MONGODB_URI", () => {
    expect(process.env.MONGODB_URI).toBeDefined();
    expect(process.env.MONGODB_URI).toContain("127.0.0.1");
  });

  it("provides a server that supports multi-document transactions", async () => {
    const client = new MongoClient(process.env.MONGODB_URI as string);
    await client.connect();

    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await client
          .db("harness_check")
          .collection("probe")
          .insertOne({ ok: true }, { session });
      });
    } finally {
      await session.endSession();
    }

    const count = await client
      .db("harness_check")
      .collection("probe")
      .countDocuments();
    expect(count).toBe(1);

    await client.db("harness_check").dropDatabase();
    await client.close();
  });
});
