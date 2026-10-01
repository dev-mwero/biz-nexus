import { z } from "zod";
import { LeadError, LeadService, type UpdateLeadInput } from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";

const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "UNQUALIFIED",
  "CONVERTED",
  "LOST",
] as const;

const updateLeadSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    contactId: z.string().optional().nullable(),
    companyId: z.string().optional().nullable(),
    source: z.string().min(1).max(100).optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    score: z.number().int().min(0).max(100).optional(),
    ownerId: z.string().optional(),
    tags: z.array(z.string()).optional(),
    notes: z.string().max(2000).optional().nullable(),
    customFields: z.record(z.unknown()).optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided",
  );

/**
 * GET /api/v1/crm/leads/:id
 * Get a lead by ID.
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

    return ok(lead);
  },
);

/**
 * PATCH /api/v1/crm/leads/:id
 * Update a lead.
 * Permission: leads.update
 */
export const PATCH = withApi(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("leads.update");

    const { id } = await params;
    const body = await request.json();
    const input = updateLeadSchema.parse(body);

    const service = new LeadService(context.organization._id, context.user._id);

    try {
      const updateInput: UpdateLeadInput = { ...input };
      if (input.contactId !== undefined) {
        updateInput.contactId = input.contactId
          ? new context.organization.constructor(input.contactId)
          : null;
      }
      if (input.companyId !== undefined) {
        updateInput.companyId = input.companyId
          ? new context.organization.constructor(input.companyId)
          : null;
      }
      if (input.ownerId)
        updateInput.ownerId = new context.organization.constructor(
          input.ownerId,
        );
      if (input.tags !== undefined) {
        updateInput.tags = input.tags.map(
          (tagId) => new context.organization.constructor(tagId),
        );
      }

      const lead = await service.update(id, updateInput, context.user._id);
      return ok(lead);
    } catch (error) {
      if (error instanceof LeadError && error.code === "RECORD_NOT_FOUND") {
        throw new AppError("RECORD_NOT_FOUND", { message: "Lead not found." });
      }
      if (error instanceof LeadError && error.code === "VALIDATION_FAILED") {
        throw new AppError("VALIDATION_FAILED", { message: error.message });
      }
      if (error instanceof LeadError && error.code === "INVALID_STATE") {
        throw new AppError("INVALID_STATE", { message: error.message });
      }
      throw error;
    }
  },
);

/**
 * DELETE /api/v1/crm/leads/:id
 * Soft delete a lead.
 * Permission: leads.delete
 */
export const DELETE = withApi(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("leads.delete");

    const { id } = await params;
    const service = new LeadService(context.organization._id, context.user._id);

    try {
      await service.delete(id, context.user._id);
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof LeadError && error.code === "RECORD_NOT_FOUND") {
        throw new AppError("RECORD_NOT_FOUND", { message: "Lead not found." });
      }
      throw error;
    }
  },
);

/**
 * POST /api/v1/crm/leads/:id/restore
 * Restore a soft-deleted lead.
 * Permission: leads.update
 */
export const POST = withApi(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("leads.update");

    const { id } = await params;
    const service = new LeadService(context.organization._id, context.user._id);

    // Access the repository directly for restore
    const repo = (service as { repo: typeof service.repo }).repo;
    const restored = await repo.restoreById(id);
    if (restored.matchedCount === 0) {
      throw new AppError("RECORD_NOT_FOUND", { message: "Lead not found." });
    }

    const lead = await service.getById(id);
    return ok(lead);
  },
);
