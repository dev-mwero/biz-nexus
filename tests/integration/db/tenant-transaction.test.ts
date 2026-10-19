import mongoose, { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { AUDIT_ACTIONS, AuditLogModel, recordAction } from "@/modules/audit";
import {
  ContactModel,
  ContactRepository,
} from "../../support/fixtures/contact-repository";

/**
 * Transactions and the tenant repository.
 *
 * Two properties are load-bearing. A write issued with a session must take part
 * in that transaction — a `create` that silently ignored the session would
 * still write and commit on its own, and the rollback would look successful
 * while leaving the row behind. And an audit row written with the same session
 * must disappear with the change it describes; a surviving row claims an event
 * that never happened.
 *
 * Both are tested by aborting a real transaction against the replica set, not
 * by inspecting the options object. Inspecting the call proves the argument was
 * passed, which is not the property that matters.
 */

const ORG = new Types.ObjectId();
const OTHER_ORG = new Types.ObjectId();
const ACTOR = new Types.ObjectId();

async function inRolledBackTransaction(
  work: (session: mongoose.ClientSession) => Promise<void>,
): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await work(session);
      throw new Error("intentional rollback");
    });
  } catch (error) {
    // `withTransaction` rethrows the callback's error after aborting. Anything
    // else — a driver error, a validation failure — would be a real failure and
    // must not be mistaken for the expected rollback.
    if (!(error instanceof Error) || error.message !== "intentional rollback") {
      throw error;
    }
  } finally {
    await session.endSession();
  }
}

beforeEach(async () => {
  await connectToDatabase();
  await ContactModel.deleteMany({ organizationId: { $in: [ORG, OTHER_ORG] } });
  await AuditLogModel.deleteMany({
    organizationId: { $in: [ORG, OTHER_ORG] },
  });
});

afterEach(async () => {
  await ContactModel.deleteMany({ organizationId: { $in: [ORG, OTHER_ORG] } });
  await AuditLogModel.deleteMany({
    organizationId: { $in: [ORG, OTHER_ORG] },
  });
});

describe("tenant repository sessions", () => {
  it("commits a create and its audit row together", async () => {
    const repo = new ContactRepository(ORG);
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const contact = await repo.create(
          {
            name: "Alice Acme",
            email: "alice@acme.test",
            ownerId: ACTOR,
          },
          { session },
        );

        await recordAction({
          organizationId: ORG,
          actor: { id: ACTOR, name: "Ada Lovelace" },
          action: AUDIT_ACTIONS.CREATE,
          entityType: "contact",
          entityId: contact._id,
          after: { name: contact.name, email: contact.email },
          session,
        });
      });
    } finally {
      await session.endSession();
    }

    expect(await ContactModel.countDocuments({ organizationId: ORG })).toBe(1);
    expect(await AuditLogModel.countDocuments({ organizationId: ORG })).toBe(1);
  });

  it("rolls back a create when the transaction aborts", async () => {
    const repo = new ContactRepository(ORG);

    await inRolledBackTransaction(async (session) => {
      await repo.create(
        {
          name: "Alice Acme",
          email: "alice@acme.test",
          ownerId: ACTOR,
        },
        { session },
      );
    });

    // A create that ignored the session would have committed on its own and
    // this assertion would fail. That is the point of the test.
    expect(await ContactModel.countDocuments({ organizationId: ORG })).toBe(0);
  });

  it("rolls back insertMany when the transaction aborts", async () => {
    const repo = new ContactRepository(ORG);

    await inRolledBackTransaction(async (session) => {
      await repo.insertMany(
        [
          {
            name: "Alice Acme",
            email: "alice@acme.test",
            ownerId: ACTOR,
          },
          {
            name: "Bob Beta",
            email: "bob@beta.test",
            ownerId: ACTOR,
          },
        ],
        { session },
      );
    });

    expect(await ContactModel.countDocuments({ organizationId: ORG })).toBe(0);
  });

  it("rolls back the audit row with the change it describes", async () => {
    const repo = new ContactRepository(ORG);

    await inRolledBackTransaction(async (session) => {
      const contact = await repo.create(
        {
          name: "Alice Acme",
          email: "alice@acme.test",
          ownerId: ACTOR,
        },
        { session },
      );

      await recordAction({
        organizationId: ORG,
        actor: { id: ACTOR, name: "Ada Lovelace" },
        action: AUDIT_ACTIONS.CREATE,
        entityType: "contact",
        entityId: contact._id,
        after: { name: contact.name, email: contact.email },
        session,
      });
    });

    expect(await ContactModel.countDocuments({ organizationId: ORG })).toBe(0);
    expect(await AuditLogModel.countDocuments({ organizationId: ORG })).toBe(0);
  });
});

describe("findOneAndUpdate tenant scope", () => {
  it("updates a record in the repository's organisation", async () => {
    const repo = new ContactRepository(ORG);
    const contact = await repo.create({
      name: "Alice Acme",
      email: "alice@acme.test",
      ownerId: ACTOR,
    });

    const updated = await repo.findOneAndUpdate(
      { _id: contact._id },
      { $set: { name: "Alice Updated" } },
    );

    expect(updated?.name).toBe("Alice Updated");
    expect((await ContactModel.findById(contact._id))?.name).toBe(
      "Alice Updated",
    );
  });

  it("returns null for a foreign id and leaves the document untouched", async () => {
    const foreign = await new ContactRepository(OTHER_ORG).create({
      name: "Bob Beta",
      email: "bob@beta.test",
      ownerId: ACTOR,
    });

    const result = await new ContactRepository(ORG).findOneAndUpdate(
      { _id: foreign._id },
      { $set: { name: "Compromised" } },
    );

    expect(result).toBeNull();
    expect((await ContactModel.findById(foreign._id))?.name).toBe("Bob Beta");
  });

  it("wins over an organizationId smuggled into the filter", async () => {
    const foreign = await new ContactRepository(OTHER_ORG).create({
      name: "Bob Beta",
      email: "bob@beta.test",
      ownerId: ACTOR,
    });

    // The type removes the key, but a cast or `any` can still reach it. The
    // runtime spread is the second line of defence, and it has to be tested
    // because the type is not present at runtime.
    const result = await new ContactRepository(ORG).findOneAndUpdate(
      { _id: foreign._id, organizationId: ORG } as never,
      { $set: { name: "Compromised" } },
    );

    expect(result).toBeNull();
    expect((await ContactModel.findById(foreign._id))?.name).toBe("Bob Beta");
  });
});
