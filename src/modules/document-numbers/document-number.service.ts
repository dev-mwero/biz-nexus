import type { ClientSession, Types } from "mongoose";
import {
  DOCUMENT_TYPES,
  type DocumentType,
} from "@/modules/document-numbers/document-sequence.model";
import { DocumentSequenceRepository } from "@/modules/document-numbers/document-sequence.repository";
import { yearInTimeZone } from "@/shared/lib/calendar";

/**
 * Document numbering.
 *
 * Format, from ADR-0010:
 *
 *   quotation   Q-2026-000042
 *   sales order SO-2026-000042
 *
 * The sequence is six digits with leading zeroes, and it grows rather than
 * truncates past 999,999. A number that silently wrapped would be worse than an
 * ugly one: it would be a duplicate.
 */

const PREFIX: Record<DocumentType, string> = {
  [DOCUMENT_TYPES.QUOTATION]: "Q",
  [DOCUMENT_TYPES.SALES_ORDER]: "SO",
};

export class DocumentNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentNumberError";
  }
}

/** Format an allocated sequence value. Pure, so the format is testable. */
export function formatDocumentNumber(
  documentType: DocumentType,
  year: number,
  value: number,
): string {
  const prefix = PREFIX[documentType];
  if (!prefix) {
    throw new DocumentNumberError(
      `Unknown document type: ${String(documentType)}`,
    );
  }
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new DocumentNumberError("A document year must be 1–9999.");
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DocumentNumberError(
      "A document sequence value must be a positive safe integer.",
    );
  }

  return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
}

export interface AllocateDocumentNumberInput {
  organizationId: Types.ObjectId | string;
  documentType: DocumentType;
  /** The organisation's IANA timezone, from settings. */
  timeZone: string;
  /** Injectable clock, so tests can pin the year. */
  now?: Date;
  /** The transaction that will write the document using this number. */
  session?: ClientSession;
  actorId?: Types.ObjectId | string | null;
}

export interface AllocatedDocumentNumber {
  number: string;
  documentType: DocumentType;
  year: number;
  value: number;
}

/**
 * Allocate the next number for a document type.
 *
 * Call this inside the same transaction as the document it numbers. The
 * caller's transaction is what makes "no number is consumed by a write that
 * did not happen" true.
 */
export async function allocateDocumentNumber(
  input: AllocateDocumentNumberInput,
): Promise<AllocatedDocumentNumber> {
  const year = yearInTimeZone(input.timeZone, input.now);
  const repository = new DocumentSequenceRepository(
    input.organizationId,
    input.actorId ?? null,
  );

  const sequence = await repository.allocate(
    input.documentType,
    year,
    input.session,
  );

  return {
    number: formatDocumentNumber(input.documentType, year, sequence.value),
    documentType: input.documentType,
    year,
    value: sequence.value,
  };
}
