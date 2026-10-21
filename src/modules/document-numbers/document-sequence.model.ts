import mongoose, { type Model, Schema, type Types } from "mongoose";
import type { TenantDocument } from "@/db/tenant-repository";

/**
 * The per-organisation counter behind quotation and sales-order numbers.
 *
 * One row per `(organizationId, documentType, year)`. The number is allocated
 * with `$inc` inside the caller's transaction (ADR-0010), not by counting
 * documents: two requests that count 41 at the same moment both write 42.
 *
 * The unique index is the concurrency backstop. The atomic increment is the
 * mechanism; the index is what makes a bug in it fail loudly rather than issue
 * the same number twice.
 */

export const DOCUMENT_TYPES = {
  QUOTATION: "QUOTATION",
  SALES_ORDER: "SALES_ORDER",
} as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[keyof typeof DOCUMENT_TYPES];

export interface DocumentSequence extends TenantDocument {
  _id: Types.ObjectId;
  documentType: DocumentType;
  /** The organisation-local year the number belongs to. */
  year: number;
  /** The last number allocated. Zero before the first allocation. */
  value: number;
  createdAt: Date;
  updatedAt: Date;
}

const documentSequenceSchema = new Schema<DocumentSequence>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    documentType: {
      type: String,
      required: true,
      enum: Object.values(DOCUMENT_TYPES),
    },
    year: {
      type: Number,
      required: true,
      min: 1,
      max: 9999,
    },
    value: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true, collection: "document_sequences" },
);

/**
 * The allocator's lookup key, and the concurrency backstop.
 *
 * `organizationId` is first because every query carries it, and the remaining
 * two fields make the triple unique. Without this index, a failed `$inc` race
 * would be invisible until two customers received the same document number.
 */
documentSequenceSchema.index(
  { organizationId: 1, documentType: 1, year: 1 },
  { unique: true },
);

export const DocumentSequenceModel: Model<DocumentSequence> =
  (mongoose.models.document_sequences as Model<DocumentSequence>) ??
  mongoose.model<DocumentSequence>(
    "document_sequences",
    documentSequenceSchema,
  );

export const documentSequenceSchemaDefinition = documentSequenceSchema;
