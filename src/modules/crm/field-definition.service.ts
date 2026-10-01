import type { Types } from "mongoose";
import { AppError, type ErrorCode } from "@/shared/errors/app-error";
import { events } from "@/shared/events/bus";
import {
  type FieldDefinition,
  FieldDefinitionModel,
  type FieldEntityType,
  type FieldType,
} from "./field-definition.model";
import { FieldDefinitionRepository } from "./field-definition.repository";

export class FieldDefinitionError extends AppError {
  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(code, { message, cause: options?.cause });
    this.name = "FieldDefinitionError";
  }
}

export interface CreateFieldDefinitionInput {
  organizationId: Types.ObjectId;
  actorId: Types.ObjectId;
  entityType: FieldEntityType;
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  order?: number;
}

export interface UpdateFieldDefinitionInput {
  label?: string;
  type?: FieldType;
  options?: string[];
  required?: boolean;
  order?: number;
}

/**
 * Field definition service.
 *
 * Manages custom field definitions. Values are stored on entities as a
 * Mixed map and validated against these definitions at write time.
 * Custom fields are NEVER indexed (per DATABASE.md).
 */
export class FieldDefinitionService {
  private repo: FieldDefinitionRepository;

  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    this.repo = new FieldDefinitionRepository(organizationId, actorId);
  }

  /** Create a new field definition. */
  async create(input: CreateFieldDefinitionInput): Promise<FieldDefinition> {
    const existing = await this.repo.findByEntityTypeAndKey(
      input.entityType,
      input.key,
    );
    if (existing) {
      throw new FieldDefinitionError(
        "SLUG_CONFLICT",
        `A field with key "${input.key}" already exists for ${input.entityType}.`,
      );
    }

    // Validate options for select types
    if (
      (input.type === "SELECT" || input.type === "MULTI_SELECT") &&
      (!input.options || input.options.length === 0)
    ) {
      throw new FieldDefinitionError(
        "VALIDATION_FAILED",
        `${input.type} fields require at least one option.`,
      );
    }

    // Validate key format
    if (!/^[a-z][a-z0-9_]*$/.test(input.key)) {
      throw new FieldDefinitionError(
        "VALIDATION_FAILED",
        "Key must be lowercase snake_case starting with a letter.",
      );
    }

    const fieldDef = await this.repo.create({
      entityType: input.entityType,
      key: input.key,
      label: input.label.trim(),
      type: input.type,
      options: input.options ?? [],
      required: input.required ?? false,
      order: input.order ?? 0,
    });

    await events.emit("fieldDefinition.created", {
      organizationId: input.organizationId,
      fieldDefinitionId: fieldDef._id,
      entityType: input.entityType,
      key: input.key,
      actorId: input.actorId,
    });

    return fieldDef;
  }

  /** Update a field definition. */
  async update(
    fieldDefinitionId: Types.ObjectId | string,
    input: UpdateFieldDefinitionInput,
    actorId: Types.ObjectId,
  ): Promise<FieldDefinition> {
    const existing = await this.repo.findById(fieldDefinitionId);
    if (!existing) {
      throw new FieldDefinitionError(
        "RECORD_NOT_FOUND",
        "Field definition not found.",
      );
    }

    // Cannot change entityType or key after creation
    // Validate options for select types
    if (
      input.type &&
      (input.type === "SELECT" || input.type === "MULTI_SELECT")
    ) {
      const options = input.options ?? existing.options;
      if (!options || options.length === 0) {
        throw new FieldDefinitionError(
          "VALIDATION_FAILED",
          `${input.type} fields require at least one option.`,
        );
      }
    }

    const changes: Record<string, unknown> = {};
    if (input.label !== undefined && input.label !== existing.label)
      changes.label = input.label.trim();
    if (input.type !== undefined && input.type !== existing.type)
      changes.type = input.type;
    if (input.options !== undefined) changes.options = input.options;
    if (input.required !== undefined && input.required !== existing.required)
      changes.required = input.required;
    if (input.order !== undefined && input.order !== existing.order)
      changes.order = input.order;

    if (Object.keys(changes).length === 0) return existing;

    const updated = await this.repo.findByIdAndUpdate(fieldDefinitionId, {
      $set: changes,
    });
    if (!updated) {
      throw new FieldDefinitionError(
        "RECORD_NOT_FOUND",
        "Field definition not found after update.",
      );
    }

    await events.emit("fieldDefinition.updated", {
      organizationId: this.repo.organizationId,
      fieldDefinitionId: existing._id,
      changes,
      actorId,
    });

    return updated;
  }

  /** Delete a field definition. */
  async delete(
    fieldDefinitionId: Types.ObjectId | string,
    actorId: Types.ObjectId,
  ): Promise<void> {
    const existing = await this.repo.findById(fieldDefinitionId);
    if (!existing) {
      throw new FieldDefinitionError(
        "RECORD_NOT_FOUND",
        "Field definition not found.",
      );
    }

    // Note: We don't remove values from entity documents here.
    // Per DATABASE.md: "removes the value from records" on delete.
    // This is handled by a separate cleanup job or at read time.
    // For MVP, we just delete the definition.

    await this.repo.softDeleteById(fieldDefinitionId);

    await events.emit("fieldDefinition.deleted", {
      organizationId: this.repo.organizationId,
      fieldDefinitionId: existing._id,
      entityType: existing.entityType,
      key: existing.key,
      actorId,
    });
  }

  /** List all field definitions for an entity type. */
  async listByEntityType(
    entityType: FieldEntityType,
  ): Promise<FieldDefinition[]> {
    return this.repo.findByEntityType(entityType);
  }

  /** Get a field definition by ID. */
  async getById(id: Types.ObjectId | string): Promise<FieldDefinition | null> {
    return this.repo.findById(id);
  }

  /** Get a field definition by entity type and key. */
  async getByEntityTypeAndKey(
    entityType: FieldEntityType,
    key: string,
  ): Promise<FieldDefinition | null> {
    return this.repo.findByEntityTypeAndKey(entityType, key);
  }

  /** Validate custom field values against definitions. */
  async validateValues(
    entityType: FieldEntityType,
    values: Record<string, unknown>,
  ): Promise<{ valid: boolean; errors: Record<string, string> }> {
    const definitions = await this.listByEntityType(entityType);
    const errors: Record<string, string> = {};

    for (const def of definitions) {
      const value = values[def.key];
      const hasValue = value !== undefined && value !== null && value !== "";

      // Check required
      if (def.required && !hasValue) {
        errors[def.key] = `${def.label} is required.`;
        continue;
      }

      if (!hasValue) continue;

      // Type validation
      switch (def.type) {
        case "TEXT":
          if (typeof value !== "string") {
            errors[def.key] = `${def.label} must be text.`;
          }
          break;
        case "NUMBER":
          if (typeof value !== "number" || !Number.isFinite(value)) {
            errors[def.key] = `${def.label} must be a number.`;
          }
          break;
        case "DATE":
          if (!(value instanceof Date) && typeof value !== "string") {
            errors[def.key] = `${def.label} must be a date.`;
          } else if (typeof value === "string" && isNaN(Date.parse(value))) {
            errors[def.key] = `${def.label} must be a valid date.`;
          }
          break;
        case "BOOLEAN":
          if (typeof value !== "boolean") {
            errors[def.key] = `${def.label} must be true or false.`;
          }
          break;
        case "SELECT":
          if (typeof value !== "string" || !def.options.includes(value)) {
            errors[def.key] =
              `${def.label} must be one of: ${def.options.join(", ")}.`;
          }
          break;
        case "MULTI_SELECT":
          if (
            !Array.isArray(value) ||
            value.some((v) => typeof v !== "string" || !def.options.includes(v))
          ) {
            errors[def.key] = `${def.label} must be an array of valid options.`;
          }
          break;
      }
    }

    // Check for unknown keys
    const knownKeys = new Set(definitions.map((d) => d.key));
    for (const key of Object.keys(values)) {
      if (!knownKeys.has(key)) {
        errors[key] = `Unknown custom field: ${key}.`;
      }
    }

    return { valid: Object.keys(errors).length === 0, errors };
  }

  /** Coerce values to their defined types. */
  async coerceValues(
    entityType: FieldEntityType,
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const definitions = await this.listByEntityType(entityType);
    const result: Record<string, unknown> = {};

    for (const def of definitions) {
      const value = values[def.key];
      if (value === undefined || value === null || value === "") continue;

      switch (def.type) {
        case "TEXT":
          result[def.key] = String(value);
          break;
        case "NUMBER": {
          const num = Number(value);
          result[def.key] = Number.isFinite(num) ? num : value;
          break;
        }
        case "DATE":
          if (value instanceof Date) {
            result[def.key] = value;
          } else if (typeof value === "string") {
            const parsed = new Date(value);
            result[def.key] = isNaN(parsed.getTime()) ? value : parsed;
          } else {
            result[def.key] = value;
          }
          break;
        case "BOOLEAN":
          if (typeof value === "boolean") result[def.key] = value;
          else if (typeof value === "string")
            result[def.key] = value.toLowerCase() === "true";
          else result[def.key] = Boolean(value);
          break;
        case "SELECT":
          result[def.key] = String(value);
          break;
        case "MULTI_SELECT":
          if (Array.isArray(value)) {
            result[def.key] = value.map(String);
          } else if (typeof value === "string") {
            result[def.key] = value.split(",").map((s) => s.trim());
          } else {
            result[def.key] = [String(value)];
          }
          break;
      }
    }

    // Pass through unknown keys as-is
    for (const [key, value] of Object.entries(values)) {
      if (!definitions.some((d) => d.key === key)) {
        result[key] = value;
      }
    }

    return result;
  }
}
