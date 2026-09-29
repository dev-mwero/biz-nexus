import type { Model, Schema } from "mongoose";
import { markSchema, readSchemaMark } from "@/db/mixins/mark";

/**
 * URL-safe identifiers.
 *
 * Only `organizations` carries a slug, and it is **globally** unique — one
 * index, `{ slug: 1 }`, with no organisation prefix. That is a deliberate
 * trade: a globally unique slug means `acme.com/companies/acme` resolves
 * without a lookup, at the cost of two organisations named "Acme" becoming
 * `acme` and `acme-2`. The alternative — per-organisation slugs with the
 * organisation in the path — makes every inbound link a database round trip
 * before it can be validated, which is both slower and a wider enumeration
 * surface.
 *
 * Uniqueness cannot be guaranteed by checking first, so the pre-check is for
 * the user's benefit and the unique index is the actual guarantee. See
 * `ensureUniqueSlug`.
 */

export const SLUG_OPTION = "bizNexusSlug" as const;

/**
 * Turn arbitrary text into a URL-safe slug.
 *
 * The accent handling is the part that matters and the part that is usually
 * wrong. `normalize("NFKD")` decomposes "é" into "e" plus a combining accent,
 * and the combining marks have to be stripped explicitly — the common shortcut
 * of replacing anything outside `[a-z0-9]` produces "caf" for "café" and
 * "acme" for "Ångström".
 */
export function slugify(
  input: string,
  options: { maxLength?: number } = {},
): string {
  const maxLength = options.maxLength ?? 80;

  const normalized = input
    .normalize("NFKD")
    // Strip the combining marks left behind by the decomposition above.
    .replace(/[̀-ͯ]/g, "")
    // ø and æ have no decomposition, so they are spelled out. Without these,
    // "Blåbær" becomes "blbr" rather than "blabaer".
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (normalized.length <= maxLength) return normalized;

  // Truncated on a hyphen boundary so a slug never ends mid-word.
  const cut = normalized.slice(0, maxLength);
  const lastHyphen = cut.lastIndexOf("-");
  return (
    lastHyphen > maxLength * 0.6 ? cut.slice(0, lastHyphen) : cut
  ).replace(/-+$/, "");
}

export type SlugFields = { slug: string };

export function slug(options: { maxLength?: number; field?: string } = {}) {
  const field = options.field ?? "slug";

  return (schema: Schema) => {
    schema.add({
      [field]: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        maxlength: options.maxLength ?? 80,
      },
    });
    markSchema(schema, SLUG_OPTION, field);
  };
}

export function slugField(schema: Schema): string | undefined {
  const value = readSchemaMark(schema, SLUG_OPTION);
  return typeof value === "string" ? value : undefined;
}

export class SlugConflictError extends Error {
  constructor(
    readonly base: string,
    readonly attempts: number,
  ) {
    super(
      `Could not find a free slug for "${base}" after ${attempts} attempts. ` +
        "This normally means a concurrent create took the same name; retry, or set the slug explicitly.",
    );
    this.name = "SlugConflictError";
  }
}

/**
 * Find a free slug, appending -2, -3 and so on.
 *
 * The pre-check is a convenience, not a guarantee: two requests creating "Acme"
 * at the same moment both see `acme` free. The unique index is what actually
 * prevents the duplicate, and this function's job is to turn the resulting
 * E11000 into a retry rather than a 500 — while reading as little as possible
 * across tenants, since the uniqueness check is inherently global.
 */
export async function ensureUniqueSlug<T extends { _id?: unknown }>(
  model: Model<T>,
  base: string,
  options: {
    maxLength?: number;
    field?: string;
    maxAttempts?: number;
    excludeId?: unknown;
  } = {},
): Promise<string> {
  const field = options.field ?? "slug";
  const maxLength = options.maxLength ?? 80;
  const maxAttempts = options.maxAttempts ?? 50;
  const root = slugify(base, { maxLength: maxLength - 4 });

  // A name in a script with no latin characters slugifies to nothing, and an
  // empty slug would be a unique-index collision on the first insert. A short
  // random suffix keeps the row insertable and the URL shareable.
  const seed = root || `org-${Math.random().toString(36).slice(2, 8)}`;

  const taken = await model
    .find({
      [field]: seed,
      ...(options.excludeId ? { _id: { $ne: options.excludeId } } : {}),
    })
    // Only the slug is read. This query necessarily crosses organisations —
    // global uniqueness means it has to — and there is no reason for it to pull
    // a single field's worth of one byte more than necessary.
    .select({ [field]: 1 })
    .lean();

  if (taken.length === 0) return seed;

  for (let suffix = 2; suffix <= maxAttempts; suffix += 1) {
    const candidate = `${seed}-${suffix}`;
    const collision = await model
      .find({
        [field]: candidate,
        ...(options.excludeId ? { _id: { $ne: options.excludeId } } : {}),
      })
      .select({ [field]: 1 })
      .lean();

    if (collision.length === 0) return candidate;
  }

  throw new SlugConflictError(seed, maxAttempts);
}
