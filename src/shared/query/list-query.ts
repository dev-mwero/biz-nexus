import { z } from "zod";
import { AppError, type FieldDetail } from "@/shared/errors/app-error";
import { type PageMeta, pageMeta } from "@/shared/responses/envelope";

/**
 * List query primitives.
 *
 * One schema decides paging, sorting, search, and the resource's own filters,
 * so that six list endpoints cannot each invent a slightly different idea of
 * what `?page=2&sort=-name` means. The shape of it is fixed by docs/API.md
 * section 8. What that document does not say is where the sharp edges are, so
 * the decisions are here with their reasons.
 *
 * The single rule underneath all of it: reject rather than repair. A typo in a
 * filter that is silently ignored returns plausible, wrong data, and the caller
 * has no way to tell that from a correct empty result. Every "be liberal in
 * what you accept" shortcut below was considered and is deliberately absent.
 *
 * Nothing here knows about Mongoose. The output is a plain Mongo sort spec plus
 * validated filters, which the DAL applies inside the tenant scope it already
 * enforces. Keeping the module free of the driver means the parsing rules are
 * unit-testable without a database, which is most of why they can be this
 * strict without being a nuisance.
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE = 10_000;
export const MAX_SEARCH_LENGTH = 200;

export type SortDirection = 1 | -1;
/** A Mongo sort document, e.g. `{ createdAt: -1, _id: 1 }`. */
export type SortSpec = Record<string, SortDirection>;

export type QueryParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

export interface ListQuery<TFilters> {
  page: number;
  pageSize: number;
  /** Ready for `Model.find().skip(skip)`. */
  skip: number;
  /** Ready for `Model.find().limit(limit)`. Always positive. */
  limit: number;
  sort: SortSpec;
  /** The raw search term, trimmed. Absent when there is nothing to search for. */
  q?: string;
  /**
   * The term as a literal, anchored-insensitive pattern. Built here rather
   * than in each service so that escaping cannot be forgotten: an unescaped
   * term lets a caller supply their own pattern, and `(a+)+$` against a large
   * collection is a denial of service, not a search.
   */
  pattern?: RegExp;
  filters: TFilters;
}

/** An inclusive range expressed as a pair of sibling filter keys. */
export type OrderedPair = readonly [string, string];

export interface ListQueryOptions<TFilters extends z.ZodRawShape> {
  /** Resource-specific filters. Must be a strict object so typos are rejected. */
  filters: z.ZodObject<TFilters>;
  /**
   * Fields this resource may be sorted by, bare and without a direction prefix.
   * Anything else is a 422. This is also the NoSQL-injection guard: without an
   * allow-list, `?sortBy[$gt]=` and dotted paths reach the driver directly.
   */
  sortable: readonly string[];
  /** Defaults to `-createdAt`. */
  defaultSort?: string;
  /** Set false for resources with nothing to search. `q` is then a 422. */
  searchable?: boolean;
  /**
   * Filter keys that must not be inverted, e.g. `["scoreMin", "scoreMax"]` or
   * `["createdFrom", "createdTo"]`. A min above its max is a request for
   * nothing; returning an empty page makes it look like the data is missing.
   */
  orderedPairs?: readonly OrderedPair[];
}

export interface ListQueryParser<TFilters extends z.ZodRawShape> {
  parse(params: QueryParams): ListQuery<z.output<z.ZodObject<TFilters>>>;
  meta(query: ListQuery<unknown>, total: number): PageMeta;
}

/**
 * A whole number written the way a client should write one.
 *
 * `z.coerce.number()` runs the string through `Number()`, which tolerates ` 2 `,
 * `0x10`, `1e400`, and `Infinity`. Tolerating those means a filter with a typo
 * in it becomes a different query rather than a 422, and `1e400` becomes
 * `Infinity` with no integer to reject. The regex is the whole point: one
 * spelling, one meaning, and everything else is an error the caller can see.
 */
function wholeNumber(schema: z.ZodNumber) {
  return z
    .string()
    .regex(/^-?\d+$/, "Expected a whole number.")
    .transform((raw) => Number(raw))
    .pipe(schema);
}

const pageSchema = wholeNumber(z.number().int().min(1).max(MAX_PAGE)).default(
  DEFAULT_PAGE,
);
const pageSizeSchema = wholeNumber(
  z.number().int().min(1).max(MAX_PAGE_SIZE),
).default(DEFAULT_PAGE_SIZE);

const sortDirSchema = z.enum(["asc", "desc"]);

/**
 * `q` is bounded and trimmed, and an empty term becomes "no search" rather
 * than a pattern that matches everything.
 *
 * A pattern built from `""` is a legitimate way to ask for the whole
 * collection, but it is also a slow way to ask for the whole collection, and
 * the honest reading of an empty search box is that the caller did not search.
 */
const searchSchema = z
  .string()
  .max(MAX_SEARCH_LENGTH)
  .transform((term) => term.trim())
  .transform((term) => (term.length === 0 ? undefined : term))
  .optional();

/**
 * A date filter, shared so that six resources cannot each accept a different
 * set of date formats.
 *
 * `z.coerce.date()` would be the obvious choice and it is wrong here: it goes
 * through `new Date()`, which accepts `Jan 2 2026`, `2026/01/02`, and `1` (read
 * as 2001-01-01). A filter that silently widens on a typo is the same failure
 * as a filter that is silently ignored. This accepts ISO 8601 only.
 *
 * A bare `2026-01-02` is midnight UTC. A bare `2026-01-02T10:30:00` is local
 * time, because that is what an `<input type="datetime-local">` sends and
 * silently shifting a caller's filter by their UTC offset is worse than having
 * them send the offset.
 */
export const dateFromQuery = z
  .union([z.iso.date(), z.iso.datetime({ local: true, offset: true })])
  .transform((value) => new Date(value));

/**
 * Escapes every character that is special in a regular expression, so the term
 * is matched literally. Deliberately more conservative than necessary: an
 * over-escaped `-` is a slightly uglier pattern that behaves identically.
 */
export function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\/\-<>&]/g, "\\$&");
}

export function searchPattern(term: string): RegExp {
  return new RegExp(escapeRegExp(term), "i");
}

/**
 * Turns either a `URLSearchParams` or a Next.js `searchParams` object into the
 * plain record Zod validates.
 *
 * Two normalisations happen here and nowhere else. A repeated key becomes an
 * array, so a scalar schema rejects `?page=1&page=2` rather than picking one.
 * And `tag[]` becomes `tag`, because the documented spelling is `tag[]` and
 * the unbracketed spelling is the one half the clients send; rejecting the
 * other half would be pedantry with no typo-safety gained. Bracketed keys are
 * not a wildcard syntax - `tag[0]=x` is an unknown key and is rejected like any
 * other.
 */
export function toQueryRecord(
  params: QueryParams,
): Record<string, string | string[]> {
  // A null prototype, deliberately. On a plain object literal, assigning to a
  // key named `__proto__` hits the prototype setter and stores nothing, so
  // `?__proto__=x` would produce no own key at all and be silently dropped
  // rather than reported as an unknown parameter - the one outcome this module
  // is not allowed to produce.
  const out: Record<string, string | string[]> = Object.create(null) as Record<
    string,
    string | string[]
  >;
  const entries: Array<[string, string | string[] | undefined]> =
    params instanceof URLSearchParams
      ? [...params.entries()]
      : Object.entries(params);

  for (const [rawKey, rawValue] of entries) {
    // Absent is absent. Next.js hands over `undefined` for a key that is not
    // there, and treating that as the empty string would turn a missing param
    // into `page: 0` and a spurious 422.
    if (rawValue === undefined) continue;

    const key = rawKey.endsWith("[]") ? rawKey.slice(0, -2) : rawKey;

    if (Array.isArray(rawValue)) {
      // A bracketed key that repeats is still a list of values, not a list of
      // lists, so no nesting check is needed here.
      const existing = out[key];
      if (existing === undefined) {
        out[key] = rawValue;
      } else {
        out[key] = [
          ...(Array.isArray(existing) ? existing : [existing]),
          ...rawValue,
        ];
      }
      continue;
    }

    const existing = out[key];
    if (existing === undefined) {
      out[key] = rawValue;
    } else {
      out[key] = Array.isArray(existing)
        ? [...existing, rawValue]
        : [existing, rawValue];
    }
  }

  return out;
}

/**
 * Keeps echoed parameter names safe to log and to show a user.
 *
 * An unknown key is attacker-controlled text, so it is truncated and stripped
 * of anything that would not survive a log line intact. Same reasoning as not
 * logging request bodies in the route wrapper: the parameter name is a small,
 * bounded fragment, not a place to reflect whatever was sent.
 */
function safeKey(key: string): string {
  return key.replace(/[\p{Cc}]/gu, "").slice(0, 40);
}

function fail(details: FieldDetail[], message?: string): never {
  throw AppError.validation(details, message);
}

/**
 * Compares two filter values for ordering. Dates and numbers are the only
 * things that can appear in an ordered pair, because those are the only
 * filters whose keys are declared as a range.
 */
function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return 0;
}

export function listQuery<TFilters extends z.ZodRawShape>(
  options: ListQueryOptions<TFilters>,
): ListQueryParser<TFilters> {
  const {
    filters: filterSchema,
    sortable,
    defaultSort = "-createdAt",
    searchable = true,
    orderedPairs = [],
  } = options;

  // Configuration is validated at construction, not per request. An allow-list
  // containing `$` or a dot is a programming error, and the request that
  // happens to exercise it is not the place to find out.
  const allowList = new Set<string>();
  for (const field of sortable) {
    if (field.startsWith("$") || field.includes(".")) {
      throw new Error(
        `listQuery: sortable field "${safeKey(field)}" must be a bare field name`,
      );
    }
    allowList.add(field);
  }

  const filterKeys = new Set(Object.keys(filterSchema.shape));

  // Which filters are lists, so that a single value can be promoted to a
  // one-element list. `?tag=urgent` and `?tag[]=urgent` have to mean the same
  // thing, and the array schema cannot tell them apart on its own.
  const listKeys = new Set(
    [...filterKeys].filter((key) => isArraySchema(filterSchema.shape[key])),
  );

  // The default sort is checked against the same allow-list, and here, rather
  // than on the first request. Forgetting to put the default's field in
  // `sortable` otherwise rejects every single request to the endpoint with a
  // message that names a field the caller never sent.
  for (const token of defaultSort.split(",")) {
    const field = token.trim().replace(/^-/, "");
    if (!allowList.has(field)) {
      throw new Error(
        `listQuery: defaultSort field "${safeKey(field)}" is not in sortable`,
      );
    }
  }

  const baseSchema = z.object({
    page: pageSchema.default(DEFAULT_PAGE),
    pageSize: pageSizeSchema.default(DEFAULT_PAGE_SIZE),
    sort: z.string().optional(),
    sortBy: z.string().optional(),
    sortDir: sortDirSchema.optional(),
    q: searchSchema,
  });

  const parse = (
    params: QueryParams,
  ): ListQuery<z.output<z.ZodObject<TFilters>>> => {
    const record = toQueryRecord(params);

    // Reject unknown keys before parsing so the message names the offending
    // parameter, which is the one piece of information that makes a typo
    // fixable. Zod would reject them too, but as a shape error with no
    // indication of which key was wrong.
    const known = new Set([
      "page",
      "pageSize",
      "sort",
      "sortBy",
      "sortDir",
      "q",
      ...filterKeys,
    ]);
    const unknown = Object.keys(record).filter((key) => !known.has(key));
    if (unknown.length > 0) {
      fail(
        unknown.map((key) => ({
          path: safeKey(key),
          message: "Unknown parameter.",
        })),
        "Unknown query parameter.",
      );
    }

    // `sort` and `sortBy` express the same thing two ways. Accepting both and
    // picking one would mean the client's ordering changes when someone adds
    // a second field to a bookmarked URL, so exactly one form is allowed.
    const hasSort = record.sort !== undefined;
    const hasSortBy =
      record.sortBy !== undefined || record.sortDir !== undefined;
    if (hasSort && hasSortBy) {
      fail([
        {
          path: "sort",
          message: "Use either sort, or sortBy with sortDir, not both.",
        },
      ]);
    }
    if (record.sortDir !== undefined && record.sortBy === undefined) {
      fail([
        {
          path: "sortDir",
          message: "sortDir requires sortBy.",
        },
      ]);
    }

    const base = baseSchema.safeParse(record);
    if (!base.success) {
      fail(zodDetails(base.error));
    }

    const { page, pageSize, sort, sortBy, sortDir, q } = base.data;

    if (q !== undefined && !searchable) {
      fail([{ path: "q", message: "This resource cannot be searched." }]);
    }

    const parsedFilters = filterSchema.safeParse(
      pick(record, filterKeys, listKeys),
    );
    if (!parsedFilters.success) {
      fail(zodDetails(parsedFilters.error));
    }
    const parsed = parsedFilters.data as Record<string, unknown>;

    for (const [lowKey, highKey] of orderedPairs) {
      const low = parsed[lowKey];
      const high = parsed[highKey];
      if (low === undefined || high === undefined) continue;
      if (compare(low, high) > 0) {
        fail([
          {
            path: lowKey,
            message: `${lowKey} must not be greater than ${highKey}.`,
          },
        ]);
      }
    }

    return {
      page,
      pageSize,
      skip: (page - 1) * pageSize,
      limit: pageSize,
      sort: buildSort({ sort, sortBy, sortDir }, allowList, defaultSort),
      ...(q === undefined ? {} : { q, pattern: searchPattern(q) }),
      filters: parsed as z.output<z.ZodObject<TFilters>>,
    };
  };

  return {
    parse,
    meta: (query, total) =>
      pageMeta({ page: query.page, pageSize: query.pageSize, total }),
  };
}

/** The core Zod shape, which is what `ZodObject.shape` actually holds. */
type ZodShapeEntry = {
  _zod?: { def?: { type?: string; innerType?: ZodShapeEntry } };
};

/**
 * Unwraps `.optional()`, `.nullable()`, `.default()` and friends to find out
 * whether a filter field is a list. Reading Zod's internal type tag is not
 * lovely, but the alternative is asking every caller to wrap their array
 * filters in a coercion helper, which is a decision pushed onto all six
 * resources to save a loop here.
 */
function isArraySchema(schema: ZodShapeEntry): boolean {
  let current: ZodShapeEntry = schema;
  for (;;) {
    const def = current._zod?.def;
    if (def === undefined) return false;
    if (def.type === "array") return true;
    if (
      def.type === "optional" ||
      def.type === "nullable" ||
      def.type === "default"
    ) {
      if (def.innerType === undefined) return false;
      current = def.innerType;
      continue;
    }
    return false;
  }
}

function pick(
  record: Record<string, string | string[]>,
  keys: Set<string>,
  listKeys: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!keys.has(key)) continue;
    // One value for a list filter is a list of one. Without this, `?tag=urgent`
    // fails an array schema while `?tag[]=urgent` succeeds, which is a
    // difference the caller cannot see in the documentation.
    out[key] = listKeys.has(key) && !Array.isArray(value) ? [value] : value;
  }
  return out;
}

function buildSort(
  input: {
    sort?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc" | undefined;
  },
  allowList: Set<string>,
  defaultSort: string,
): SortSpec {
  const spec: SortSpec = {};

  const apply = (field: string, descending: boolean) => {
    if (!allowList.has(field)) {
      fail([
        {
          path: "sort",
          message: `Cannot sort by "${safeKey(field)}".`,
        },
      ]);
    }
    spec[field] = descending ? -1 : 1;
  };

  if (input.sortBy !== undefined) {
    apply(input.sortBy, input.sortDir === "desc");
  } else {
    // Comma-separated so `-createdAt,name` is one parameter. An empty `sort` is
    // treated as absent rather than as an empty field name, which would fail
    // the allow-list for a reason the caller cannot see.
    const requested =
      input.sort === undefined || input.sort.trim() === ""
        ? defaultSort
        : input.sort;
    for (const token of requested.split(",")) {
      const trimmed = token.trim();
      if (trimmed === "") continue;
      if (trimmed.startsWith("-")) apply(trimmed.slice(1), true);
      else apply(trimmed, false);
    }
  }

  // Offset paging silently duplicates and skips rows when the sort key has
  // ties, because Mongo is free to return equal keys in any order. `_id` is
  // unique, so appending it makes the order total. The default sort is
  // `-createdAt`, which ties constantly for anything created in a batch.
  if (!("_id" in spec)) {
    spec._id = 1;
  }

  return spec;
}

/**
 * Flattens a Zod error into the `details` shape the API already returns.
 *
 * The issue `path` is joined rather than nested so a client can highlight the
 * input that caused the failure, and the message is Zod's own text, which is
 * written for a user and contains no value that was sent.
 */
function zodDetails(error: z.ZodError): FieldDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
