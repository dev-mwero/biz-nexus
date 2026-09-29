import type { Schema } from "mongoose";

/**
 * Marking a schema with a capability the repository needs to know about.
 *
 * Mongoose types `schema.set`/`schema.get` against `keyof SchemaOptions`, so a
 * custom key is rejected. Rather than casting at each of the six call sites —
 * where a reviewer sees a bare `as never` and has to go looking for why — the
 * narrowing happens once, here, next to the explanation.
 *
 * A marker rather than a subclass or a symbol because the information has to
 * survive being attached to a schema and then read back through a `Model<T>` in
 * a generic base class, where the concrete schema type is not in scope.
 */

/** The subset of Schema these helpers use, with arbitrary keys permitted. */
type MarkableSchema = {
  set(key: string, value: unknown): unknown;
  get(key: string): unknown;
};

export function markSchema(schema: Schema, key: string, value: unknown): void {
  (schema as unknown as MarkableSchema).set(key, value);
}

export function readSchemaMark(schema: Schema, key: string): unknown {
  return (schema as unknown as MarkableSchema).get(key);
}
