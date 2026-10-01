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
