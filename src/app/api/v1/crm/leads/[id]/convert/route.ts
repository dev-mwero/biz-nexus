import { Types } from "mongoose";
import { z } from "zod";
import { LeadError, LeadService } from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError, type FieldDetail } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";
import { pathParam } from "../../../../../_lib/path-param";

const dealInputSchema = z.object({
  name: z.string().min(1).max(160),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  value: z.number().nonnegative().optional(),
  expectedCloseDate: z.string().datetime().optional(),
});

const convertLeadSchema = z
  .object({
    createContact: z.boolean().default(true),
    createCompany: z.boolean().default(true),
    createDeal: z.boolean().default(false),
    deal: dealInputSchema.optional(),
    customFields: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((data) => {
    if (data.createDeal && !data.deal) return false;
    return true;
  }, "Deal details are required when createDeal is true");

/**
 * POST /api/v1/crm/leads/:id/convert
 * Convert a lead to Contact (+ Company + Deal).
 * Permission: leads.convert
 */
export const POST = withApi(
  async (request: Request) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("leads.convert");

    // `fromEnd: 2` — this path ends in a static segment (`route.ts`), so the
    // default of 1 would read that literal as the record id.
    const id = pathParam(request, 2);
    const body = await request.json();
    const input = convertLeadSchema.parse(body);

    const service = new LeadService(context.organization._id, context.user._id);

    try {
      const result = await service.convert(
        id,
        {
          createContact: input.createContact,
          createCompany: input.createCompany,
          createDeal: input.createDeal,
          // The parsed deal carries ids as strings and the close date as text;
          // the conversion runs in a transaction against documents, so all three
          // are translated here rather than pushed through the repository.
          deal: input.deal
            ? {
                ...input.deal,
                pipelineId: new Types.ObjectId(input.deal.pipelineId),
                stageId: new Types.ObjectId(input.deal.stageId),
                expectedCloseDate: input.deal.expectedCloseDate
                  ? new Date(input.deal.expectedCloseDate)
                  : undefined,
              }
            : undefined,
          customFields: input.customFields,
        },
        context.user._id,
      );

      return ok(result);
    } catch (error) {
      if (error instanceof LeadError && error.code === "RECORD_NOT_FOUND") {
        throw new AppError("RECORD_NOT_FOUND", { message: "Lead not found." });
      }
      if (error instanceof LeadError && error.code === "INVALID_STATE") {
        // Already converted. The service attaches the ids it created under
        // `cause` so a retrying client can pick up where it left off; each one
        // becomes its own field detail, which is the catalogue's structured
        // slot. There is no dedicated "wrong state" code, and this refusal
        // describes a body that could never succeed against this record, which
        // is what 422 means.
        const cause = error.cause;
        const details: FieldDetail[] =
          cause && typeof cause === "object"
            ? Object.entries(cause).map(([path, value]) => ({
                path: `leadId.${path}`,
                message: String(value),
              }))
            : [];
        throw new AppError("VALIDATION_FAILED", {
          message: error.message,
          details,
        });
      }
      if (error instanceof LeadError && error.code === "VALIDATION_FAILED") {
        throw new AppError("VALIDATION_FAILED", { message: error.message });
      }
      if (
        error instanceof LeadError &&
        error.code === "CONFIGURATION_INVALID"
      ) {
        throw new AppError("CONFIGURATION_INVALID", { message: error.message });
      }
      throw error;
    }
  },
  { status: 201 },
);
