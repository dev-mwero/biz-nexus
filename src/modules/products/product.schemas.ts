import { z } from "zod";
import {
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
} from "@/modules/products/product.model";
import { MAX_UNIT_PRICE_MINOR } from "@/shared/lib/money";

/**
 * Request schemas for the products endpoints.
 *
 * `strictObject`, for the reason `deal.schemas` gives: a key the schema does not
 * know is a typo or a probe, and dropping it silently teaches the caller it was
 * accepted. The unknown key is rejected rather than ignored.
 *
 * `currency` and `organizationId` are declared and never accepted. A product's
 * currency is the organisation's currency, snapshotted at create, and the tenant
 * comes from the session; neither is the client's to choose. They are listed so
 * `strictObject` does not report them as unrecognised - the caller used the
 * wrong field, not an unknown one - and so `ProductService` refuses them by name
 * and says which field is server-owned. The same pattern `deal.schemas` uses for
 * `stageId`/`pipelineId`.
 */
export const createProductBody = z.strictObject({
  name: z.string(),
  sku: z.string().nullish(),
  description: z.string().nullish(),
  type: z.enum(PRODUCT_TYPES),
  unitPriceMinor: z.number().int().min(0).max(MAX_UNIT_PRICE_MINOR),
  unitLabel: z.string().nullish(),

  currency: z.string().optional(),
  organizationId: z.string().optional(),
});

export const updateProductBody = z.strictObject({
  name: z.string().optional(),
  sku: z.string().nullish(),
  description: z.string().nullish(),
  type: z.enum(PRODUCT_TYPES).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  unitPriceMinor: z.number().int().min(0).max(MAX_UNIT_PRICE_MINOR).optional(),
  unitLabel: z.string().nullish(),

  currency: z.string().optional(),
  organizationId: z.string().optional(),
});

export type CreateProductBody = z.infer<typeof createProductBody>;
export type UpdateProductBody = z.infer<typeof updateProductBody>;
