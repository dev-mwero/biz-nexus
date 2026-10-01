import { z } from "zod";
import { LeadError, LeadService } from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";

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
    customFields: z.record(z.unknown()).default({}),
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
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("leads.convert");

    const { id } = await params;
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
          deal: input.deal
            ? {
                ...input.deal,
                pipelineId: new context.organization.constructor(
                  input.deal.pipelineId,
                ),
                stageId: new context.organization.constructor(
                  input.deal.stageId,
                ),
                expectedCloseDate: input.deal.expectedCloseDate
                  ? new Date(input.deal.expectedCloseDate)
                  : undefined,
              }
            : undefined,
          customFields: input.customFields,
        },
        context.user._id,
      );

      return ok(result, undefined, { status: 201 });
    } catch (error) {
      if (error instanceof LeadError && error.code === "RECORD_NOT_FOUND") {
        throw new AppError("RECORD_NOT_FOUND", { message: "Lead not found." });
      }
      if (error instanceof LeadError && error.code === "INVALID_STATE") {
        const details = error.options?.cause as
          | Record<string, unknown>
          | undefined;
        throw new AppError("INVALID_STATE", {
          message: error.message,
          details: details ? [{ path: "leadId", ...details }] : undefined,
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
);
