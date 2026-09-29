import type { Model, Schema } from "mongoose";
import { markSchema, readSchemaMark } from "@/db/mixins/mark";
import { AppError } from "@/shared/errors/app-error";

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

export class SlugConflictError extends AppError {
  constructor(
    readonly base: string,
    readonly attempts: number,
    options?: { cause?: unknown },
  ) {
    super("SLUG_CONFLICT", {
      message:
        `Could not find a free slug for "${base}" after ${attempts} attempts. ` +
        "This normally means a concurrent create took the same name; retry, or set the slug explicitly.",
      cause: options?.cause,
    });
    this.name = "SlugConflictError";
  }
}

/**
 * Whether a duplicate-key error was raised by the slug index specifically.
 *
 * `code === 11000` covers every unique index in the database. Keying on the
 * field is what stops a duplicate email from being retried into `user-2@x.com`.
 */
export function isDuplicateKeyOn(error: unknown, field: string): boolean {
  if (typeof error !== "object" || error === null) return false;

  const candidate = error as {
    code?: unknown;
    keyPattern?: Record<string, unknown>;
  };

  // Mongoose wraps the driver error and preserves both fields.
  if (candidate.code === 11000) {
    const pattern = candidate.keyPattern;
    // A driver-level duplicate with no keyPattern still needs handling; a
    // wrapped one always has it, and that is where the field can be read.
    return pattern ? Object.hasOwn(pattern, field) : true;
  }

  return false;
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
    probeFrom?: number;
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

  const offset = options.probeFrom ?? 0;
  for (let suffix = 2 + offset; suffix <= maxAttempts + offset; suffix += 1) {
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

/**
 * Create a document, resolving slug collisions by retrying.
 *
 * `ensureUniqueSlug` alone is not enough. Two requests creating "Acme" at the
 * same moment both check, both see `acme` free, and both insert; the unique
 * index then rejects one with E11000. Without this the loser gets a 500 for a
 * name that was free a moment ago and is now taken by its own twin.
 *
 * The retry is narrow on purpose. A duplicate-key error is retried only when it
 * is on the *slug* field, because the same error on `email` means a genuinely
 * duplicate account, and retrying that would loop while appending `-2` to a
 * person's email address. The distinction is read from `keyPattern`, which
 * MongoDB populates with the index that actually fired.
 */
export async function createWithUniqueSlug<T>(
  model: Model<T>,
  base: string,
  build: (slug: string) => Omit<T, "_id">,
  options: {
    maxLength?: number;
    field?: string;
    maxAttempts?: number;
  } = {},
): Promise<T> {
  const field = options.field ?? "slug";
  const maxAttempts = options.maxAttempts ?? 8;
  let candidate = slugify(base, { maxLength: options.maxLength ?? 80 });
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await model.create({
        ...build(candidate),
        [field]: candidate,
      } as T);
    } catch (error) {
      if (!isDuplicateKeyOn(error, field)) throw error;
      lastError = error;
      // Re-read rather than guess the next suffix: another writer may have
      // taken several while this request was in flight, and a guessed "-2"
      // would collide with the same index that just rejected us.
      //
      // The offset is zero for the first retry and random afterwards. One
      // collision is the ordinary case — somebody else created "Acme" a moment
      // ago — and it should land on "-2" every time, not on whichever of
      // "-2" to "-5" a coin flip chose, which would leave gaps in the sequence
      // and make the outcome untestable. Sustained contention is what needs
      // the spread, and it only shows up as repeated collisions.
      candidate = await ensureUniqueSlug(model, candidate, {
        ...options,
        probeFrom: attempt === 0 ? 0 : Math.floor(Math.random() * 4),
      });
    }
  }

  throw new SlugConflictError(base, maxAttempts, { cause: lastError });
}
