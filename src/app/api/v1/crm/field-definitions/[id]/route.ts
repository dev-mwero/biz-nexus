import { z } from "zod";
import {
  FieldDefinitionError,
  FieldDefinitionService,
  type UpdateFieldDefinitionInput,
} from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";
import { pathParam } from "../../../../_lib/path-param";

const FIELD_TYPES = [
  "TEXT",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
  "MULTI_SELECT",
] as const;

const updateFieldDefinitionSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    type: z.enum(FIELD_TYPES).optional(),
    options: z.array(z.string()).optional(),
    required: z.boolean().optional(),
    order: z.number().int().optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided",
  )
  .refine((data) => {
    if (
      (data.type === "SELECT" || data.type === "MULTI_SELECT") &&
      data.options !== undefined &&
      (!data.options || data.options.length === 0)
    ) {
      return false;
    }
    return true;
  }, "SELECT and MULTI_SELECT fields require at least one option");

/**
 * GET /api/v1/crm/custom-fields/:id
 * Get a field definition by ID.
 * Permission: fieldDefinitions.read
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("fieldDefinitions.read");

  const id = pathParam(request);
  const service = new FieldDefinitionService(
    context.organization._id,
    context.user._id,
  );

  const fieldDef = await service.getById(id);
  if (!fieldDef) {
    throw new AppError("RECORD_NOT_FOUND", {
      message: "Field definition not found.",
    });
  }

  return ok(fieldDef);
});

/**
 * PATCH /api/v1/crm/custom-fields/:id
 * Update a field definition.
 * Permission: fieldDefinitions.update
 */
export const PATCH = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("fieldDefinitions.update");

  const id = pathParam(request);
  const body = await request.json();
  const input = updateFieldDefinitionSchema.parse(body);

  const service = new FieldDefinitionService(
    context.organization._id,
    context.user._id,
  );

  try {
    // The schema narrows to exactly the fields the service accepts, so this is a
    // narrowing of an already-checked shape rather than a way of silencing the
    // compiler.
    const fieldDef = await service.update(
      id,
      input as UpdateFieldDefinitionInput,
      context.user._id,
    );
    return ok(fieldDef);
  } catch (error) {
    if (
      error instanceof FieldDefinitionError &&
      error.code === "RECORD_NOT_FOUND"
    ) {
      throw new AppError("RECORD_NOT_FOUND", {
        message: "Field definition not found.",
      });
    }
    if (
      error instanceof FieldDefinitionError &&
      error.code === "VALIDATION_FAILED"
    ) {
      throw new AppError("VALIDATION_FAILED", { message: error.message });
    }
    throw error;
  }
});

/**
 * DELETE /api/v1/crm/custom-fields/:id
 * Delete a field definition.
 * Permission: fieldDefinitions.delete
 */
export const DELETE = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("fieldDefinitions.delete");

  const id = pathParam(request);
  const service = new FieldDefinitionService(
    context.organization._id,
    context.user._id,
  );

  try {
    await service.delete(id, context.user._id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (
      error instanceof FieldDefinitionError &&
      error.code === "RECORD_NOT_FOUND"
    ) {
      throw new AppError("RECORD_NOT_FOUND", {
        message: "Field definition not found.",
      });
    }
    throw error;
  }
});
