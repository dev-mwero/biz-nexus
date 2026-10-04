import { z } from "zod";

/**
 * Read query parameters into the shape a Zod schema expects.
 *
 * `Object.fromEntries(searchParams)` is the obvious way to do this and it is
 * wrong for repeated parameters. `fromEntries` keeps the *last* value for a
 * duplicated key, so `?tag=a&tag=b` becomes `{ tag: "b" }` and `?tag=a`
 * becomes `{ tag: "a" }` — a string. A schema field declared
 * `z.array(z.string())` then rejects the request with "expected array, received
 * string", which is a 400 for a URL that is perfectly well formed and which the
 * client has no way of writing differently. The filter silently accepts one tag
 * instead of two, or the endpoint refuses to be filtered at all.
 *
 * `getAll` is the fix, and it has to be requested per key, so the keys are
 * passed in. They are listed rather than inferred: the schema already declares
 * which fields are arrays, but it is a Zod schema, not a readable table, and a
 * call site that names its array parameters is self-documenting in a way that
 * "we guessed" is not.
 *
 * Comma-separated values are also accepted, because `?tag=a,b` is what a client
 * writes when it builds a URL by joining a list and nobody wants a 400 for it.
 * Blank entries are dropped, so `?tag=` is an empty filter rather than a filter
 * for the empty string.
 */
export function queryFromSearchParams(
  searchParams: URLSearchParams,
  arrayKeys: readonly string[] = [],
): Record<string, string | string[]> {
  const arrays = new Set(arrayKeys);
  const result: Record<string, string | string[]> = {};
  const scalars = new Set<string>();

  for (const [key, value] of searchParams) {
    if (arrays.has(key)) {
      const entries = (result[key] as string[] | undefined) ?? [];
      entries.push(...value.split(","));
      result[key] = entries;
      continue;
    }
    // First value wins for a scalar. Duplicated scalars are a client bug, and
    // honouring the last one is how a filter ends up applied to something the
    // caller did not ask for.
    if (scalars.has(key)) continue;
    scalars.add(key);
    result[key] = value;
  }

  for (const key of arrays) {
    result[key] =
      (result[key] as string[] | undefined)?.filter(
        (entry) => entry.trim().length > 0,
      ) ?? [];
  }

  return result;
}

/**
 * A boolean that arrives in a query string, which is always a string.
 *
 * `z.coerce.boolean()` is the obvious tool here and it is wrong in the direction
 * that does not announce itself. Coercion is `Boolean(value)`, so on a string
 * that means *any* non-empty string is `true`: `?hasEmail=false` is `true`,
 * `?hasEmail=0` is `true`, `?hasEmail=no` is `true`. `GET /api/v1/crm/contacts`
 * passed this schema to `hasEmail`, so the one query that asked for contacts
 * *without* an email address returned the ones with them — and the filter is
 * applied, so nothing about the response says the parameter was ignored.
 *
 * There is no lenient reading to fall back on, either. `Boolean("false")` being
 * true is a language quirk, not a convention anyone could be expected to know, so
 * a filter that quietly does the opposite of what was asked for is not a
 * trade-off worth making — especially on a query whose whole job is to decide
 * which records you are allowed to see.
 *
 * The literals are explicit, case-insensitive, and anything else is a 422 with a
 * message that says which values are accepted. Refusing `?hasEmail=1` is a better
 * outcome than answering it as `true`: the caller learns their spelling is wrong
 * instead of trusting a filter they did not get.
 */
export function queryBoolean(): z.ZodType<boolean> {
  return z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => value === "true" || value === "false", {
      message: 'expected "true" or "false"',
    })
    .transform((value) => value === "true");
}
