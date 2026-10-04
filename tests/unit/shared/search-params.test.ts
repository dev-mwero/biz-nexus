import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  queryBoolean,
  queryFromSearchParams,
} from "@/shared/api/search-params";

/**
 * Query-string booleans, which is the whole job of `queryBoolean`.
 *
 * The reason this helper exists is a bug that never announced itself: the
 * contacts list declared `hasEmail: z.coerce.boolean().optional()`, and
 * `Boolean("false")` is `true`, so `?hasEmail=false` returned the contacts *with*
 * an email address. The filter was applied, so the response looked like an
 * answer to the question asked.
 *
 * Every case below is a string a caller could plausibly put in a URL, and the
 * ones that used to be read as `true` are the ones worth pinning.
 */
describe("queryBoolean", () => {
  const schema = z.object({ flag: queryBoolean().optional() });

  it("reads the two documented literals", () => {
    expect(schema.parse({ flag: "true" })).toEqual({ flag: true });
    expect(schema.parse({ flag: "false" })).toEqual({ flag: false });
  });

  it.each(["TRUE", "True", "true", "  true  "])("reads %o as true", (value) => {
    expect(schema.parse({ flag: value })).toEqual({ flag: true });
  });

  it.each([
    "FALSE",
    "False",
    "false",
    "  false  ",
  ])("reads %o as false", (value) => {
    expect(schema.parse({ flag: value })).toEqual({ flag: false });
  });

  /**
   * The bug, written as a table.
   *
   * Every one of these is a non-empty string, which is exactly the condition
   * `Boolean()` checks, so `z.coerce.boolean()` turned all of them into `true`.
   * Refusing them is the point: accepting `"1"` as `true` and `"0"` as `false`
   * would be defensible on its own, but mixing two conventions on one parameter
   * is how you get here in the first place.
   */
  it.each([
    "1",
    "0",
    "no",
    "yes",
    "on",
    "off",
    "y",
    "n",
    "null",
    "undefined",
  ])("refuses %o instead of coercing it", (value) => {
    const result = schema.safeParse({ flag: value });
    expect(result.success).toBe(false);
  });

  it("refuses the empty string rather than reading it as false", () => {
    // `?flag=` is a blank parameter. Reading it as `false` would silently turn a
    // malformed URL into a filter, which is the same class of surprise as the
    // bug: the caller asked something malformed and got a confident answer.
    expect(schema.safeParse({ flag: "" }).success).toBe(false);
    expect(schema.safeParse({ flag: "   " }).success).toBe(false);
  });

  it("leaves an absent flag absent", () => {
    // Not `false`. An absent filter and a filter of `false` are different
    // queries, and collapsing them would make it impossible to express
    // "everything" as distinct from "the false branch".
    expect(schema.parse({})).toEqual({});
  });

  it("refuses a real boolean, which is a body value rather than a query one", () => {
    // If this ever accepts `true`/`false` booleans, the helper has been reused
    // for a JSON body somewhere, where the coercion bug does not apply and the
    // string-only contract is just noise.
    expect(schema.safeParse({ flag: true }).success).toBe(false);
  });

  it("names the acceptable values in the issue", () => {
    const result = schema.safeParse({ flag: "1" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toContain('"true" or "false"');
  });

  it("reports the parameter, not the body", () => {
    // The path is what a client shows next to the field it got wrong, so it has
    // to survive the `z.object` wrapper.
    const result = schema.safeParse({ flag: "nope" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].path).toEqual(["flag"]);
  });

  it("composes with the rest of a list query", () => {
    // Not just usable alone. The contacts schema puts `hasEmail` next to
    // `tag`, `status` and a date range, and all of them go through
    // `queryFromSearchParams` first, so this follows the real path: URL to
    // parsed record to schema.
    const filters = schema.parse(
      queryFromSearchParams(new URLSearchParams("flag=false")),
    );
    expect(filters).toEqual({ flag: false });
  });
});
