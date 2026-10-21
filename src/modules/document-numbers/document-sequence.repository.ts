import type { ClientSession, Types } from "mongoose";
import { type ScopedFilter, TenantRepository } from "@/db/tenant-repository";
import {
  type DocumentSequence,
  DocumentSequenceModel,
  type DocumentType,
} from "@/modules/document-numbers/document-sequence.model";

/**
 * The sequence repository.
 *
 * The only operation is allocation, and it is a single atomic update. There is
 * deliberately no `set` or `reset`: a number is never reused, and a counter
 * that can be written by hand is a counter that can be made to collide.
 */
export class DocumentSequenceRepository extends TenantRepository<DocumentSequence> {
  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    super(DocumentSequenceModel, organizationId, actorId);
  }

  /**
   * Increment the counter and return the allocated row.
   *
   * `upsert` plus `$inc` is the whole mechanism:
   *
   *   - the filter fields (`organizationId` from the scope, `documentType`,
   *     `year`) are copied into the inserted document by MongoDB, so the row
   *     starts with the right identity;
   *   - `$inc` on a missing `value` creates `1`;
   *   - `returnDocument: "after"` returns the number that was just allocated,
   *     not the previous one.
   *
   * The update is inside the caller's transaction when `session` is supplied.
   * That is what makes a rolled-back quotation release its number instead of
   * leaving a gap that nothing records.
   */
  async allocate(
    documentType: DocumentType,
    year: number,
    session?: ClientSession,
  ): Promise<DocumentSequence> {
    const sequence = await this.findOneAndUpdate(
      { documentType, year } as ScopedFilter<DocumentSequence>,
      { $inc: { value: 1 } },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
        ...(session ? { session } : {}),
      },
    );

    if (!sequence) {
      // `upsert` plus `returnDocument: "after"` always returns a document. A
      // null here means the write did not happen, and returning 0 or inventing
      // a number would turn a database failure into a duplicate.
      throw new Error("Document sequence allocation returned no document.");
    }

    return sequence;
  }
}
