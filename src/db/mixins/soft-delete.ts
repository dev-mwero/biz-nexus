import type { Schema, SchemaDefinitionProperty } from "mongoose";
import { markSchema, readSchemaMark } from "@/db/mixins/mark";

/**
 * Soft delete, and the reason it is enforced in the repository rather than in
 * a query middleware.
 *
 * ADR-0003 rejected middleware for tenant scoping because it is invisible at
 * the call site and cannot be deliberately bypassed. Neither objection applies
 * here. The scope belongs in `TenantRepository.scope()`, which is a real method
 * with one call site to audit, and the exceptions are named methods — the same
 * pattern the tenant scope uses, for the same reason.
 *
 * `deletedAt: null` is set on every read, write and delete. A middleware
 * default could be bypassed by any future `Model.find` outside the
 * repository; this cannot, because there is no other path.
 */

export const SOFT_DELETE_OPTION = "bizNexusSoftDelete" as const;

export type SoftDeleteFields = {
  deletedAt: Date | null;
};

/**
 * Adds `deletedAt` and marks the schema so the repository knows to filter on it.
 *
 * `default: null` rather than `required` with a null value: a document that was
 * never deleted must be insertable without the field, and `null` is the single
 * value that means "present".
 */
export function softDelete(
  options: { index?: boolean; scopeField?: string } = {},
) {
  const definition: SchemaDefinitionProperty = {
    type: Date,
    default: null,
  };

  if (options.index !== false && !options.scopeField) {
    // Sparse, because most rows in a soft-delete collection are never deleted
    // and an index entry for each of them is write cost for no read benefit.
    definition.index = { sparse: true };
  }

  return (schema: Schema) => {
    schema.add({ deletedAt: definition });

    if (options.scopeField) {
      // On a tenant-owned collection the soft-delete filter is never the only
      // one: TenantRepository.scope() adds `deletedAt: null` alongside the
      // organisation, so every read is `organizationId` + `deletedAt` + fields.
      // A standalone deletedAt index would serve an unscoped query, which is
      // precisely the shape docs/DATABASE.md section 1 wants to be slow enough
      // to catch in development. Leading with the scope field keeps the trash
      // view indexed without opening that door.
      schema.index({ [options.scopeField]: 1, deletedAt: 1 });
    }

    markSchema(schema, SOFT_DELETE_OPTION, true);
  };
}

/** Whether a model's schema opted in to soft delete. */
export function isSoftDeleteSchema(schema: Schema): boolean {
  return readSchemaMark(schema, SOFT_DELETE_OPTION) === true;
}

/**
 * A filter matching everything except a specific soft-delete state.
 *
 * Kept as a plain object so it composes with the repository's filter type,
 * which strips `organizationId` but leaves `deletedAt` alone.
 */
export const NOT_DELETED = { deletedAt: null } as const;
export const DELETED = { deletedAt: { $ne: null } } as const;
