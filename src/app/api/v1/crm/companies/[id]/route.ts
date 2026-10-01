import type { Types } from "mongoose";
import { z } from "zod";
import {
  CompanyError,
  CompanyService,
  type UpdateCompanyInput,
} from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";

const COMPANY_STATUSES = [
  "PROSPECT",
  "CUSTOMER",
  "PARTNER",
  "SUPPLIER",
  "INACTIVE",
] as const;

const addressSchema = z
  .object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().length(2).optional(),
  })
  .optional()
  .nullable();

const updateCompanySchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    legalName: z.string().max(160).optional().nullable(),
    industry: z.string().max(100).optional().nullable(),
    website: z.string().url().optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    billingAddress: addressSchema,
    shippingAddress: addressSchema,
    ownerId: z.string().optional(),
    status: z.enum(COMPANY_STATUSES).optional(),
    tags: z.array(z.string()).optional(),
    notes: z.string().max(2000).optional().nullable(),
    customFields: z.record(z.unknown()).optional(),
    size: z.number().int().positive().optional().nullable(),
    annualRevenue: z.number().nonnegative().optional().nullable(),
    parentId: z.string().optional().nullable(),
    domain: z.string().max(255).optional().nullable(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided",
  );

/**
 * GET /api/v1/crm/companies/:id
 * Get a company by ID.
 * Permission: companies.read
 */
export const GET = withApi(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("companies.read");

    const { id } = await params;
    const service = new CompanyService(
      context.organization._id,
      context.user._id,
    );

    const company = await service.getById(id);
    if (!company) {
      throw new AppError("RECORD_NOT_FOUND", { message: "Company not found." });
    }

    return ok(company);
  },
);

/**
 * PATCH /api/v1/crm/companies/:id
 * Update a company.
 * Permission: companies.update
 */
export const PATCH = withApi(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("companies.update");

    const { id } = await params;
    const body = await request.json();
    const input = updateCompanySchema.parse(body);

    const service = new CompanyService(
      context.organization._id,
      context.user._id,
    );

    try {
      const updateInput: UpdateCompanyInput = { ...input };
      if (input.ownerId)
        updateInput.ownerId = new context.organization.constructor(
          input.ownerId,
        );
      if (input.tags)
        updateInput.tags = input.tags.map(
          (t) => new context.organization.constructor(t),
        );
      if (input.parentId !== undefined) {
        updateInput.parentId = input.parentId
          ? new context.organization.constructor(input.parentId)
          : null;
      }

      const company = await service.update(id, updateInput, context.user._id);
      return ok(company);
    } catch (error) {
      if (error instanceof CompanyError && error.code === "RECORD_NOT_FOUND") {
        throw new AppError("RECORD_NOT_FOUND", {
          message: "Company not found.",
        });
      }
      if (error instanceof CompanyError && error.code === "CONFLICT") {
        throw new AppError("CONFLICT", { message: error.message });
      }
      if (error instanceof CompanyError && error.code === "VALIDATION_FAILED") {
        throw new AppError("VALIDATION_FAILED", { message: error.message });
      }
      throw error;
    }
  },
);

/**
 * DELETE /api/v1/crm/companies/:id
 * Soft delete a company.
 * Permission: companies.delete
 */
export const DELETE = withApi(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("companies.delete");

    const { id } = await params;
    const service = new CompanyService(
      context.organization._id,
      context.user._id,
    );

    try {
      await service.delete(id, context.user._id);
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof CompanyError && error.code === "RECORD_NOT_FOUND") {
        throw new AppError("RECORD_NOT_FOUND", {
          message: "Company not found.",
        });
      }
      if (error instanceof CompanyError && error.code === "CONFLICT") {
        throw new AppError("CONFLICT", { message: error.message });
      }
      throw error;
    }
  },
);

/**
 * POST /api/v1/crm/companies/:id/restore
 * Restore a soft-deleted company.
 * Permission: companies.update
 */
export const POST = withApi(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("companies.update");

    const { id } = await params;
    const service = new CompanyService(
      context.organization._id,
      context.user._id,
    );

    const restored = await (service as any).repo.restoreById(id);
    if (restored.matchedCount === 0) {
      throw new AppError("RECORD_NOT_FOUND", { message: "Company not found." });
    }

    const company = await service.getById(id);
    return ok(company);
  },
);
