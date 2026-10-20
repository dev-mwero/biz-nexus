import { Types } from "mongoose";
import { TenantRepository } from "@/db/tenant-repository";
import {
  type CustomerSnapshot,
  type QuotationLine,
  type QuotationRevision,
  QuotationRevisionModel,
  type QuotationRevisionStatus,
} from "@/modules/quotations/quotation-revision.model";

/** Convert a request-shaped reference to the id stored in MongoDB. */
function toObjectId(value: Types.ObjectId | string): Types.ObjectId {
  if (value instanceof Types.ObjectId) return value;
  return new Types.ObjectId(value);
}

export interface QuotationRevisionCreateInput {
  quotationId: Types.ObjectId | string;
  revision: number;
  status?: QuotationRevisionStatus;
  lineItems: QuotationLine[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  validUntil: string;
  terms?: string | null;
  notes?: string | null;
  customerSnapshot: CustomerSnapshot;
  sentAt?: Date | null;
  acceptedAt?: Date | null;
  rejectedAt?: Date | null;
  supersededAt?: Date | null;
  voidedAt?: Date | null;
}

/**
 * Fields a client or the service may change on a revision.
 *
 * `organizationId`, `quotationId` and `revision` are immutable: a revision is
 * addressed by its parent and its sequence number, and moving either would
 * break the unique `(organizationId, quotationId, revision)` key that makes
 * history unambiguous.
 */
export interface QuotationRevisionUpdatePayload {
  lineItems?: QuotationLine[];
  subtotalMinor?: number;
  taxMinor?: number;
  totalMinor?: number;
  validUntil?: string;
  terms?: string | null;
  notes?: string | null;
  customerSnapshot?: CustomerSnapshot;
  status?: QuotationRevisionStatus;
  sentAt?: Date | null;
  acceptedAt?: Date | null;
  rejectedAt?: Date | null;
  supersededAt?: Date | null;
  voidedAt?: Date | null;
}

export const QUOTATION_REVISION_EDITABLE_FIELDS = [
  "lineItems",
  "subtotalMinor",
  "taxMinor",
  "totalMinor",
  "validUntil",
  "terms",
  "notes",
  "customerSnapshot",
  "status",
  "sentAt",
  "acceptedAt",
  "rejectedAt",
  "supersededAt",
  "voidedAt",
] as const satisfies readonly (keyof QuotationRevisionUpdatePayload)[];

export type QuotationRevisionEditableField =
  (typeof QUOTATION_REVISION_EDITABLE_FIELDS)[number];

/**
 * Repository for quotation revisions.
 *
 * The parent-qualified lookups stay scoped, so asking for a revision by a
 * foreign quotation id answers `null` rather than another tenant's history.
 */
export class QuotationRevisionRepository extends TenantRepository<QuotationRevision> {
  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    super(QuotationRevisionModel, organizationId, actorId);
  }

  async findRevisionById(
    id: Types.ObjectId | string,
  ): Promise<QuotationRevision | null> {
    return this.findById(id).lean<QuotationRevision | null>().exec();
  }

  async findRevisionByNumber(
    quotationId: Types.ObjectId | string,
    revision: number,
  ): Promise<QuotationRevision | null> {
    return this.findOne({ quotationId: toObjectId(quotationId), revision })
      .lean<QuotationRevision | null>()
      .exec();
  }

  listRevisions(
    filter: Record<string, unknown> = {},
    options: {
      sort?: Record<string, 1 | -1>;
      limit?: number;
      skip?: number;
      projection?: Record<string, unknown>;
    } = {},
  ) {
    const { sort = { revision: -1 }, limit, skip, projection } = options;
    return this.find(filter, projection, { sort, limit, skip }).lean();
  }

  countRevisions(filter: Record<string, unknown> = {}) {
    return this.countDocuments(filter);
  }

  create(
    input: QuotationRevisionCreateInput,
    options?: Parameters<TenantRepository<QuotationRevision>["create"]>[1],
  ): ReturnType<TenantRepository<QuotationRevision>["create"]> {
    return super.create(
      {
        quotationId: toObjectId(input.quotationId),
        revision: input.revision,
        status: input.status ?? "DRAFT",
        lineItems: input.lineItems,
        subtotalMinor: input.subtotalMinor,
        taxMinor: input.taxMinor,
        totalMinor: input.totalMinor,
        validUntil: input.validUntil,
        terms: input.terms ?? null,
        notes: input.notes ?? null,
        customerSnapshot: input.customerSnapshot,
        sentAt: input.sentAt ?? null,
        acceptedAt: input.acceptedAt ?? null,
        rejectedAt: input.rejectedAt ?? null,
        supersededAt: input.supersededAt ?? null,
        voidedAt: input.voidedAt ?? null,
      },
      options,
    );
  }

  update(
    id: Types.ObjectId | string,
    update: Partial<QuotationRevisionUpdatePayload>,
    options?: Parameters<
      TenantRepository<QuotationRevision>["findByIdAndUpdate"]
    >[2],
  ) {
    return this.findByIdAndUpdate(id, { $set: update }, options);
  }
}
