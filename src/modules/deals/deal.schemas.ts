import { z } from "zod";

/**
 * Request schemas for the deals endpoints.
 *
 * This is an allowlist and nothing more. The default `z.object` silently drops
 * keys it does not recognise, so a client sending `{"name": "x",
 * "organizationId": "..."}` gets a 200 and no tenant change, and the client
 * reasonably concludes the field was accepted. Rejecting the unknown key is the
 * honest answer: it is a typo, or it is someone probing which extra fields the
 * API will take.
 *
 * The field types are the wire contract and no more. Bounds, length caps and
 * normalisation were deliberately left out: the contract this replaced was a
 * bare TypeScript type with none of them, so every bound added here rejects a
 * request that used to succeed. If a bound is wanted, it is a product decision
 * with its own change - not something to arrive inside a security fix. The one
 * field that earns an exception is spelled out below.
 */
export const updateDealBody = z.strictObject({
  name: z.string().optional(),
  companyId: z.string().nullish(),
  contactId: z.string().nullish(),
  ownerId: z.string().optional(),
  value: z.number().optional(),
  currency: z.string().optional(),
  probability: z.number().optional(),
  expectedCloseDate: z.string().nullish(),
  description: z.string().nullish(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),

  /**
   * Declared, never accepted.
   *
   * A deal's stage is owned by `POST /api/v1/deals/:id/move`, which maintains
   * `status`, `closedAt` and `lostReason` together with the event and the audit
   * entry. These two keys are listed so `strictObject` does not report them as
   * unrecognised typos - the caller did not make a mistake, they used the wrong
   * endpoint - and so they reach `DealService.update`, which refuses them by
   * name and says which endpoint to use instead. Rejecting them here as well
   * would put the same sentence in two files for no gain: the message belongs
   * to the layer that knows what the move endpoint does.
   */
  stageId: z.string().optional(),
  pipelineId: z.string().optional(),
});
