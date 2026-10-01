import { z } from "zod";
import {
  type CreateFieldDefinitionInput,
  FieldDefinitionError,
  FieldDefinitionService,
} from "@/modules/crm";
import { queryFromSearchParams } from "@/shared/api/search-params";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok, pageMeta } from "@/shared/responses/envelope";

const FIELD_ENTITY_TYPES = [
  "CONTACT",
  "COMPANY",
  "LEAD",
  "DEAL",
  "TASK",
] as const;
const FIELD_TYPES = [
  "TEXT",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
  "MULTI_SELECT",
] as const;

const createFieldDefinitionSchema = z
  .object({
    entityType: z.enum(FIELD_ENTITY_TYPES),
    key: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1).max(80),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string()).default([]),
    required: z.boolean().default(false),
    order: z.number().int().default(0),
  })
  .refine((data) => {
    if (
      (data.type === "SELECT" || data.type === "MULTI_SELECT") &&
      (!data.options || data.options.length === 0)
    ) {
      return false;
    }
    return true;
  }, "SELECT and MULTI_SELECT fields require at least one option");

const listQuerySchema = z.object({
  entityType: z.enum(FIELD_ENTITY_TYPES),
});

/**
 * GET /api/v1/crm/custom-fields/:entityType
 * List field definitions for an entity type.
 * Permission: fieldDefinitions.read
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("fieldDefinitions.read");

  const { searchParams } = new URL(request.url);
  const query = listQuerySchema.parse(queryFromSearchParams(searchParams, []));

  const service = new FieldDefinitionService(
    context.organization._id,
    context.user._id,
  );
  const fields = await service.listByEntityType(query.entityType);

  return ok(fields);
});

/**
 * POST /api/v1/crm/custom-fields
 * Create a new field definition.
 * Permission: fieldDefinitions.create
 */
export const POST = withApi(
  async (request: Request) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("fieldDefinitions.create");

    const body = await request.json();
    const input = createFieldDefinitionSchema.parse(body);

    const service = new FieldDefinitionService(
      context.organization._id,
      context.user._id,
    );

    try {
      const fieldDef = await service.create({
        organizationId: context.organization._id,
        actorId: context.user._id,
        ...input,
      });

      return ok(fieldDef);
    } catch (error) {
      // The service raises SLUG_CONFLICT for a field whose key is already taken
      // by another field on the same entity; the catalogue has no narrower code
      // for a duplicate field key.
      if (
        error instanceof FieldDefinitionError &&
        error.code === "SLUG_CONFLICT"
      ) {
        throw new AppError("SLUG_CONFLICT", { message: error.message });
      }
      if (
        error instanceof FieldDefinitionError &&
        error.code === "VALIDATION_FAILED"
      ) {
        throw new AppError("VALIDATION_FAILED", { message: error.message });
      }
      throw error;
    }
  },
  { status: 201 },
);
