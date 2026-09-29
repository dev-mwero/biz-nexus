import { Schema, type Types } from "mongoose";
import { markSchema, readSchemaMark } from "@/db/mixins/mark";

/**
 * Who did this, and who last changed it.
 *
 * `createdAt` and `updatedAt` come from Mongoose's `timestamps` option, which
 * nobody can forget to set. `createdBy` and `updatedBy` have no equivalent,
 * because Mongoose does not know who is making the request, and they are the
 * fields an incident review actually reads — "who deleted the deal" is
 * unanswerable without them.
 *
 * They are stamped by the repository from the acting user captured alongside
 * the organisation, never taken from a request body. A client that can name its
 * own author is an audit log that records what the client wanted.
 */

export const AUDIT_FIELDS_OPTION = "bizNexusAuditFields" as const;

export type AuditFields = {
  /**
   * `Types.ObjectId`, not `Schema.Types.ObjectId`.
   *
   * The latter is the SchemaType *class* when used as a TypeScript type, so an
   * interface declaring it is describing a schema definition rather than a
   * document. Any schema extending this then infers a `create()` input that
   * expects a SchemaType for these fields, and every caller passing a real
   * ObjectId fails to typecheck.
   */
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
};

/**
 * The references are declared but not resolved, and deliberately not
 * `ref`-populated. An audit field is read almost exclusively as a displayed
 * name, always by id, and populating on read would join the users collection
 * on every list view to render a column that was on screen anyway.
 */
export function auditFields() {
  return (schema: Schema) => {
    schema.add({
      createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    });
    markSchema(schema, AUDIT_FIELDS_OPTION, true);
  };
}

export function hasAuditFields(schema: Schema): boolean {
  return readSchemaMark(schema, AUDIT_FIELDS_OPTION) === true;
}
