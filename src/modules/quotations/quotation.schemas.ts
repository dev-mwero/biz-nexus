import { z } from "zod";
import { QUOTATION_STATUSES } from "@/modules/quotations/quotation.model";
import { isValidCalendarDate } from "@/shared/lib/calendar";
import {
  MAX_LINE_ITEMS,
  MAX_QUANTITY_MILLI,
  MAX_UNIT_PRICE_MINOR,
} from "@/shared/lib/money";

/**
 * Request schemas for the quotation endpoints.
 *
 * `strictObject`, for the reason `product.schemas` gives: a key the schema does
 * not know is a typo or a probe, and dropping it silently teaches the caller it
 * was accepted. The unknown key is rejected rather than ignored.
 *
 * The keys grouped after the blank line are declared and never accepted. A
 * client sends inputs only; the server owns the number, the state, every
 * currency and every total. Listing them keeps `strictObject` from reporting a
 * semantically valid but server-owned field as an unrecognised key, and lets
 * `QuotationService` refuse them by name and say which field is server-owned.
 * The same pattern `deal.schemas` uses for `stageId`/`pipelineId`.
 */
const calendarDate = z.string().refine(isValidCalendarDate, {
  message: "Must be a real calendar date in YYYY-MM-DD format.",
});

const serverOwnedLineKeys = {
  position: z.number().int().optional(),
  productName: z.string().optional(),
  sku: z.string().nullish(),
  unitLabel: z.string().nullish(),
  listPriceMinor: z.number().int().optional(),
  lineSubtotalMinor: z.number().int().optional(),
  lineTaxMinor: z.number().int().optional(),
  lineTotalMinor: z.number().int().optional(),
};

export const quotationLineBody = z.strictObject({
  productId: z.string(),
  quantityMilli: z.number().int().positive().max(MAX_QUANTITY_MILLI),
  unitPriceMinor: z.number().int().min(0).max(MAX_UNIT_PRICE_MINOR).optional(),
  taxRateBps: z.number().int().min(0).max(10_000),

  ...serverOwnedLineKeys,
});

const serverOwnedQuotationKeys = {
  currency: z.string().optional(),
  organizationId: z.string().optional(),
  number: z.string().optional(),
  status: z.enum(QUOTATION_STATUSES).optional(),
  currentRevisionId: z.string().optional(),
  currentRevisionNumber: z.number().int().optional(),
  subtotalMinor: z.number().optional(),
  taxMinor: z.number().optional(),
  totalMinor: z.number().optional(),
  acceptedRevisionId: z.string().nullish(),
  acceptedAt: z.string().nullish(),
  orderId: z.string().nullish(),
  convertedAt: z.string().nullish(),
  companyName: z.string().optional(),
  contactName: z.string().nullish(),
};

export const createQuotationBody = z.strictObject({
  companyId: z.string(),
  contactId: z.string().nullish(),
  dealId: z.string().nullish(),
  ownerId: z.string().optional(),
  validUntil: calendarDate,
  terms: z.string().max(5000).nullish(),
  notes: z.string().max(5000).nullish(),
  lineItems: z.array(quotationLineBody).min(1).max(MAX_LINE_ITEMS),

  ...serverOwnedQuotationKeys,
});

export const updateQuotationBody = z.strictObject({
  contactId: z.string().nullish(),
  dealId: z.string().nullish(),
  ownerId: z.string().optional(),
  validUntil: calendarDate.optional(),
  terms: z.string().max(5000).nullish(),
  notes: z.string().max(5000).nullish(),
  lineItems: z.array(quotationLineBody).min(1).max(MAX_LINE_ITEMS).optional(),

  ...serverOwnedQuotationKeys,
  companyId: z.string().nullish(),
});

export type QuotationLineBody = z.infer<typeof quotationLineBody>;
export type CreateQuotationBody = z.infer<typeof createQuotationBody>;
export type UpdateQuotationBody = z.infer<typeof updateQuotationBody>;
