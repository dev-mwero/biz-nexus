import mongoose, { Types } from "mongoose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import {
  allocateDocumentNumber,
  DOCUMENT_TYPES,
  DocumentSequenceModel,
  type DocumentType,
} from "@/modules/document-numbers";

/**
 * Document numbering against a real replica set.
 *
 * The failure this suite exists to catch is the one a unit test cannot see:
 * two requests allocating at the same moment and receiving the same number.
 * The counter is correct only if the increment is atomic *and* the unique index
 * is present, so both are exercised together.
 */

const ORG_A = new Types.ObjectId("64d0000000000000000000a1");
const ORG_B = new Types.ObjectId("64d0000000000000000000b2");

interface AllocateInput {
  organizationId: Types.ObjectId;
  documentType: DocumentType;
  timeZone?: string;
  now?: Date;
}

async function allocateInTransaction(input: AllocateInput) {
  const session = await mongoose.startSession();
  let allocated: Awaited<ReturnType<typeof allocateDocumentNumber>> | undefined;
  try {
    await session.withTransaction(async () => {
      allocated = await allocateDocumentNumber({
        ...input,
        now: input.now ?? new Date("2026-06-15T12:00:00.000Z"),
        timeZone: input.timeZone ?? "UTC",
        session,
      });
    });
  } finally {
    await session.endSession();
  }
  if (!allocated) throw new Error("Allocation did not run.");
  return allocated;
}

async function allocateInRolledBackTransaction(input: AllocateInput) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await allocateDocumentNumber({
        ...input,
        now: input.now ?? new Date("2026-06-15T12:00:00.000Z"),
        timeZone: input.timeZone ?? "UTC",
        session,
      });
      throw new Error("intentional rollback");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "intentional rollback") {
      throw error;
    }
  } finally {
    await session.endSession();
  }
}

beforeAll(async () => {
  await connectToDatabase();
  // The unique index is part of the correctness argument. Waiting for it
  // removes the possibility that a concurrency test passes only because the
  // index had not finished building.
  await DocumentSequenceModel.init();
});

beforeEach(async () => {
  await DocumentSequenceModel.deleteMany({
    organizationId: { $in: [ORG_A, ORG_B] },
  });
});

describe("document numbering", () => {
  it("starts every organisation at one", async () => {
    const first = await allocateInTransaction({
      organizationId: ORG_A,
      documentType: DOCUMENT_TYPES.QUOTATION,
    });
    const second = await allocateInTransaction({
      organizationId: ORG_B,
      documentType: DOCUMENT_TYPES.QUOTATION,
    });

    expect(first.number).toBe("Q-2026-000001");
    expect(second.number).toBe("Q-2026-000001");
  });

  it("increments sequentially for one organisation", async () => {
    const first = await allocateInTransaction({
      organizationId: ORG_A,
      documentType: DOCUMENT_TYPES.QUOTATION,
    });
    const second = await allocateInTransaction({
      organizationId: ORG_A,
      documentType: DOCUMENT_TYPES.QUOTATION,
    });

    expect([first.number, second.number]).toEqual([
      "Q-2026-000001",
      "Q-2026-000002",
    ]);
  });

  it("gives concurrent allocations unique numbers", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        allocateInTransaction({
          organizationId: ORG_A,
          documentType: DOCUMENT_TYPES.QUOTATION,
        }),
      ),
    );

    const numbers = results.map((result) => result.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.sort()).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `Q-2026-${String(index + 1).padStart(6, "0")}`,
      ),
    );
  });

  it("keeps quotation and order sequences independent", async () => {
    const quotation = await allocateInTransaction({
      organizationId: ORG_A,
      documentType: DOCUMENT_TYPES.QUOTATION,
    });
    const order = await allocateInTransaction({
      organizationId: ORG_A,
      documentType: DOCUMENT_TYPES.SALES_ORDER,
    });

    expect(quotation.number).toBe("Q-2026-000001");
    expect(order.number).toBe("SO-2026-000001");
  });

  it("starts a new sequence when the year rolls over", async () => {
    const thisYear = await allocateInTransaction({
      organizationId: ORG_A,
      documentType: DOCUMENT_TYPES.QUOTATION,
    });
    const nextYear = await allocateInTransaction({
      organizationId: ORG_A,
      documentType: DOCUMENT_TYPES.QUOTATION,
      now: new Date("2027-01-02T12:00:00.000Z"),
    });

    expect(thisYear.number).toBe("Q-2026-000001");
    expect(nextYear.number).toBe("Q-2027-000001");
  });

  it("uses the organisation-local year, not the server's", async () => {
    const allocated = await allocateInTransaction({
      organizationId: ORG_A,
      documentType: DOCUMENT_TYPES.QUOTATION,
      timeZone: "Africa/Nairobi",
      now: new Date("2025-12-31T23:30:00.000Z"),
    });

    expect(allocated.year).toBe(2026);
    expect(allocated.number).toBe("Q-2026-000001");
  });

  it("does not consume a number when the transaction rolls back", async () => {
    await allocateInRolledBackTransaction({
      organizationId: ORG_A,
      documentType: DOCUMENT_TYPES.QUOTATION,
    });

    const allocated = await allocateInTransaction({
      organizationId: ORG_A,
      documentType: DOCUMENT_TYPES.QUOTATION,
    });

    expect(allocated.number).toBe("Q-2026-000001");
  });
});
