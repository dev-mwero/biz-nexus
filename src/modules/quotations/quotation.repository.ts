import { Types } from "mongoose";
import { TenantRepository } from "@/db/tenant-repository";
import {
  type Quotation,
  QuotationModel,
  type QuotationStatus,
} from "@/modules/quotations/quotation.model";

/** Convert a request-shaped reference to the id stored in MongoDB. */
function toObjectId(value: Types.ObjectId | string): Types.ObjectId {
  if (value instanceof Types.ObjectId) return value;
  return new Types.ObjectId(value);
}

function optionalObjectId(
  value: Types.ObjectId | string | null | undefined,
): Types.ObjectId | null {
  if (value == null) return null;
  return toObjectId(value);
}

export interface QuotationCreateInput {
  number: string;
  status?: QuotationStatus;
  currentRevisionId: Types.ObjectId | string;
  currentRevisionNumber: number;
  acceptedRevisionId?: Types.ObjectId | string | null;
  acceptedAt?: Date | null;
  orderId?: Types.ObjectId | string | null;
  convertedAt?: Date | null;
  companyId: Types.ObjectId | string;
  companyName: string;
  contactId?: Types.ObjectId | string | null;
  contactName?: string | null;
  dealId?: Types.ObjectId | string | null;
  ownerId: Types.ObjectId | string;
  currency: string;
  validUntil: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Fields a client may change on the parent.
 *
 * `companyId`, `status`, `currency` and `number` are deliberately absent. The
 * company is fixed for the life of a quotation, status moves only through the
 * service's state machine, and the other two are snapshots written by the
 * server.
 */
export interface QuotationUpdatePayload {
  contactId?: Types.ObjectId | string | null;
  contactName?: string | null;
  dealId?: Types.ObjectId | string | null;
  ownerId?: Types.ObjectId | string;
  validUntil?: string;
  subtotalMinor?: number;
  taxMinor?: number;
  totalMinor?: number;
  currentRevisionId?: Types.ObjectId | string;
  currentRevisionNumber?: number;
}

export const QUOTATION_EDITABLE_FIELDS = [
  "contactId",
  "contactName",
  "dealId",
  "ownerId",
  "validUntil",
  "subtotalMinor",
  "taxMinor",
  "totalMinor",
  "currentRevisionId",
  "currentRevisionNumber",
] as const satisfies readonly (keyof QuotationUpdatePayload)[];

export type QuotationEditableField = (typeof QUOTATION_EDITABLE_FIELDS)[number];

function normalizeUpdate(
  update: Partial<QuotationUpdatePayload>,
): QuotationUpdatePayload {
  const normalized: QuotationUpdatePayload = { ...update };

  if (normalized.contactId !== undefined && normalized.contactId !== null) {
    normalized.contactId = toObjectId(normalized.contactId);
  }
  if (normalized.dealId !== undefined && normalized.dealId !== null) {
    normalized.dealId = toObjectId(normalized.dealId);
  }
  if (normalized.ownerId !== undefined) {
    normalized.ownerId = toObjectId(normalized.ownerId);
  }
  if (normalized.currentRevisionId !== undefined) {
    normalized.currentRevisionId = toObjectId(normalized.currentRevisionId);
  }

  return normalized;
}

/**
 * Repository for quotations.
 *
 * Every operation is scoped to the organizationId captured at construction, so
 * a foreign id reads as absent and an update cannot cross tenants.
 */
export class QuotationRepository extends TenantRepository<Quotation> {
  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    super(QuotationModel, organizationId, actorId);
  }

  findQuotations(
    filter: Record<string, unknown> = {},
    options: {
      sort?: Record<string, 1 | -1>;
      limit?: number;
      skip?: number;
      projection?: Record<string, unknown>;
    } = {},
  ) {
    const { sort = { createdAt: -1 }, limit, skip, projection } = options;
    return this.find(filter, projection, { sort, limit, skip }).lean();
  }

  countQuotations(filter: Record<string, unknown> = {}) {
    return this.countDocuments(filter);
  }

  async findQuotationById(
    id: Types.ObjectId | string,
  ): Promise<Quotation | null> {
    return this.findById(id).lean<Quotation | null>().exec();
  }

  async findQuotationByNumber(number: string): Promise<Quotation | null> {
    return this.findOne({ number }).lean<Quotation | null>().exec();
  }

  create(
    input: QuotationCreateInput,
    options?: Parameters<TenantRepository<Quotation>["create"]>[1],
  ): ReturnType<TenantRepository<Quotation>["create"]> {
    return super.create(
      {
        number: input.number,
        status: input.status ?? "DRAFT",
        currentRevisionId: toObjectId(input.currentRevisionId),
        currentRevisionNumber: input.currentRevisionNumber,
        acceptedRevisionId: optionalObjectId(input.acceptedRevisionId),
        acceptedAt: input.acceptedAt ?? null,
        rejectedAt: null,
        voidedAt: null,
        orderId: optionalObjectId(input.orderId),
        convertedAt: input.convertedAt ?? null,
        companyId: toObjectId(input.companyId),
        companyName: input.companyName,
        contactId: optionalObjectId(input.contactId),
        contactName: input.contactName ?? null,
        dealId: optionalObjectId(input.dealId),
        ownerId: toObjectId(input.ownerId),
        currency: input.currency,
        validUntil: input.validUntil,
        subtotalMinor: input.subtotalMinor,
        taxMinor: input.taxMinor,
        totalMinor: input.totalMinor,
      },
      options,
    );
  }

  update(
    id: Types.ObjectId | string,
    update: Partial<QuotationUpdatePayload>,
    options?: Parameters<TenantRepository<Quotation>["findByIdAndUpdate"]>[2],
  ) {
    return this.findByIdAndUpdate(
      id,
      { $set: normalizeUpdate(update) },
      options,
    );
  }
}
