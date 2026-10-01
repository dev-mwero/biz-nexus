import { z } from "zod";
import { LeadError, LeadService } from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";

const convertPreviewSchema = z.object({
  createContact: z.boolean().default(true),
  createCompany: z.boolean().default(true),
  createDeal: z.boolean().default(false),
  deal: z
    .object({
      name: z.string().min(1).max(160),
      pipelineId: z.string().min(1),
      stageId: z.string().min(1),
      value: z.number().nonnegative().optional(),
      expectedCloseDate: z.string().datetime().optional(),
    })
    .optional(),
  customFields: z.record(z.unknown()).default({}),
});

/**
 * GET /api/v1/crm/leads/:id/convert-preview
 * Preview what would be created on lead conversion.
 * Permission: leads.read
 */
export const GET = withApi(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("leads.read");

    const { id } = await params;
    const service = new LeadService(context.organization._id, context.user._id);

    const lead = await service.getById(id);
    if (!lead) {
      throw new AppError("RECORD_NOT_FOUND", { message: "Lead not found." });
    }

    if (lead.status === "CONVERTED") {
      return ok({
        alreadyConverted: true,
        convertedContactId: lead.convertedContactId,
        convertedCompanyId: lead.convertedCompanyId,
        convertedDealId: lead.convertedDealId,
      });
    }

    // Build preview of what would be created
    const preview: Record<string, unknown> = {
      contact: lead.contactSnapshot
        ? {
            firstName: lead.contactSnapshot.firstName,
            lastName: lead.contactSnapshot.lastName,
            email: lead.contactSnapshot.email,
            phone: lead.contactSnapshot.phone,
            companyName: lead.contactSnapshot.companyName,
          }
        : null,
      company: lead.contactSnapshot.companyName
        ? {
            name: lead.contactSnapshot.companyName,
            domain: lead.contactSnapshot.email
              ? lead.contactSnapshot.email.split("@")[1]?.toLowerCase()
              : null,
          }
        : null,
      deal: null,
    };

    return ok(preview);
  },
);
