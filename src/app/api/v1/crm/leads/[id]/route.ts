import { Types } from "mongoose";
import { z } from "zod";
import {
  LeadError,
  LeadRepository,
  LeadService,
  type UpdateLeadInput,
} from "@/modules/crm";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";
import { pathParam } from "../../../../_lib/path-param";

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
    customFields: z.record(z.string(), z.unknown()).optional(),
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
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("leads.read");

  const id = pathParam(request);
  const service = new LeadService(context.organization._id, context.user._id);

  const lead = await service.getById(id);
  if (!lead) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Lead not found." });
  }

  return ok(lead);
});

/**
 * PATCH /api/v1/crm/leads/:id
 * Update a lead.
 * Permission: leads.update
 */
export const PATCH = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("leads.update");

  const id = pathParam(request);
  const body = await readJson(request);
  const input = updateLeadSchema.parse(body);

  const service = new LeadService(context.organization._id, context.user._id);

  try {
    // Only the id-bearing fields need translating, and each is translated only
    // when it was supplied: an update distinguishes "clear this" from "leave
    // this alone", so `null` must survive and a missing key must stay missing.
    const { contactId, companyId, ownerId, tags, ...rest } = input;
    const updateInput: UpdateLeadInput = {
      ...rest,
      ...(contactId !== undefined
        ? { contactId: contactId ? new Types.ObjectId(contactId) : null }
        : {}),
      ...(companyId !== undefined
        ? { companyId: companyId ? new Types.ObjectId(companyId) : null }
        : {}),
      ...(ownerId ? { ownerId: new Types.ObjectId(ownerId) } : {}),
      ...(tags !== undefined
        ? { tags: tags.map((tagId) => new Types.ObjectId(tagId)) }
        : {}),
    };

    const lead = await service.update(id, updateInput, context.user._id);
    return ok(lead);
  } catch (error) {
    if (error instanceof LeadError && error.code === "RECORD_NOT_FOUND") {
      throw new AppError("RECORD_NOT_FOUND", { message: "Lead not found." });
    }
    if (error instanceof LeadError && error.code === "VALIDATION_FAILED") {
      throw new AppError("VALIDATION_FAILED", { message: error.message });
    }
    // A converted or soft-deleted lead cannot be updated. The catalogue has no
    // dedicated "wrong state" code, and this refusal describes a body that
    // could never succeed against this record, which is what 422 means.
    if (error instanceof LeadError && error.code === "INVALID_STATE") {
      throw new AppError("VALIDATION_FAILED", { message: error.message });
    }
    throw error;
  }
});

/**
 * DELETE /api/v1/crm/leads/:id
 * Soft delete a lead.
 * Permission: leads.delete
 */
export const DELETE = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("leads.delete");

  const id = pathParam(request);
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
});
