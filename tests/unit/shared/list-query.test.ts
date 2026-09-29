import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/shared/errors/app-error";
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  dateFromQuery,
  escapeRegExp,
  listQuery,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  searchPattern,
  toQueryRecord,
} from "@/shared/query/list-query";

/**
 * List query primitives.
 *
 * The behaviour worth testing is the refusal, not the happy path. Parsing
 * `?page=2` is a default; the tests here exist to pin down what is a 422, what
 * is a 500, and what a caller can talk the server into doing that they should
 * not. Every "rejects" case asserts the code as well as the throw, because a
 * caller branching on `VALIDATION_FAILED` is the whole point of the taxonomy.
 */

const filters = z.strictObject({
  status: z.enum(["LEAD", "QUALIFIED", "CUSTOMER", "LOST"]).optional(),
  ownerId: z.string().min(1).optional(),
  tag: z.array(z.string().min(1)).optional(),
  createdFrom: dateFromQuery.optional(),
  createdTo: dateFromQuery.optional(),
  hasEmail: z.stringbool().optional(),
});

const contacts = listQuery({
  filters,
  sortable: ["name", "createdAt", "updatedAt", "_id"],
  defaultSort: "-createdAt",
  orderedPairs: [["createdFrom", "createdTo"]],
});

const query = (search: string) => contacts.parse(new URLSearchParams(search));

/** Asserts a 422 with the catalogue code, and returns the details for probing. */
function expectRejected(params: string) {
  try {
    query(params);
  } catch (error) {
    expect(error, `expected ${params} to be rejected`).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code, `code for ${params}`).toBe("VALIDATION_FAILED");
    expect(appError.status, `status for ${params}`).toBe(422);
    expect(appError.expose).toBe(true);
    return appError.details ?? [];
  }
  throw new Error(`expected ${params} to be rejected, but it parsed`);
}

describe("defaults", () => {
  it("applies the documented defaults for an empty query", () => {
    const result = contacts.parse(new URLSearchParams());

    expect(result.page).toBe(DEFAULT_PAGE);
    expect(result.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(result.skip).toBe(0);
    expect(result.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(result.filters).toEqual({});
    expect(result.q).toBeUndefined();
    expect(result.pattern).toBeUndefined();
  });

  it("defaults to newest first, with a unique tiebreaker", () => {
    expect(query("").sort).toEqual({ createdAt: -1, _id: 1 });
  });

  it("is one source of paging maths for the response envelope", () => {
    const result = query("page=3&pageSize=25");

    expect(result.skip).toBe(50);
    expect(contacts.meta(result, 137)).toEqual({
      page: 3,
      pageSize: 25,
      total: 137,
      totalPages: 6,
    });
  });
});

describe("pagination", () => {
  it("accepts the boundaries", () => {
    expect(query("page=1&pageSize=1").pageSize).toBe(1);
    expect(query(`page=${MAX_PAGE}&pageSize=${MAX_PAGE_SIZE}`).page).toBe(
      MAX_PAGE,
    );
  });

  it("rejects a pageSize above the hard maximum instead of truncating it", () => {
    // The contract says 422, not "you get 100". Silently truncating makes the
    // response look like it honoured pageSize=500.
    expect(expectRejected("pageSize=101").map((d) => d.path)).toContain(
      "pageSize",
    );
  });

  it.each([
    ["pageSize=0", "zero page size"],
    ["pageSize=-1", "negative"],
    ["pageSize=1.5", "fractional"],
    ["pageSize=abc", "not a number"],
    ["pageSize=", "empty"],
    ["page=0", "page below one"],
    ["page=abc", "page not a number"],
    ["page=Infinity", "infinite"],
    ["page=1e400", "overflows to infinity"],
  ])("rejects %s (%s)", (search) => {
    expectRejected(search);
  });

  it("rejects a page beyond the deep-paging cap", () => {
    // A skip of tens of millions is a full collection scan per page, and the
    // contract's answer to that is cursor paging, not a bigger offset.
    expect(expectRejected(`page=${MAX_PAGE + 1}`).map((d) => d.path)).toContain(
      "page",
    );
  });

  it("rejects a repeated scalar rather than picking one", () => {
    // First or last wins would both be a guess. Guessing which one the caller
    // meant is exactly the "plausible but wrong data" failure.
    expectRejected("page=1&page=2");
  });

  it("rejects a number padded with whitespace", () => {
    // Number(" 2 ") is 2, so this only fails because the whole-number regex
    // runs first. That is the point of having the regex.
    expect(expectRejected("page=%20%202%20").map((d) => d.message)).toContain(
      "Expected a whole number.",
    );
  });

  it.each([
    ["page=0x10", "hexadecimal"],
    ["page=1e3", "exponential notation"],
    ["page=+2", "a leading plus"],
    ["page=2,000", "a thousands separator"],
  ])("rejects %s (%s)", (search) => {
    expectRejected(search);
  });
});

describe("unknown parameters", () => {
  it("rejects a mistyped parameter instead of ignoring it", () => {
    const details = expectRejected("pagesize=10");

    expect(details).toEqual([
      { path: "pagesize", message: "Unknown parameter." },
    ]);
  });

  it("rejects an unknown filter for this resource", () => {
    // `stageId` is a real deal filter, not a contact filter. Accepting it
    // would return every contact, and the caller would conclude there are no
    // staged contacts.
    expect(expectRejected("stageId=abc").map((d) => d.path)).toContain(
      "stageId",
    );
  });

  it("names every unknown parameter, not just the first", () => {
    expect(expectRejected("nope=1&alsoNope=2")).toHaveLength(2);
  });

  it("does not reject a bracketed array spelling", () => {
    expect(query("tag[]=urgent&tag[]=vip").filters.tag).toEqual([
      "urgent",
      "vip",
    ]);
  });

  it("rejects bracket indexing, which is not an array syntax here", () => {
    expect(expectRejected("tag[0]=urgent").map((d) => d.path)).toContain(
      "tag[0]",
    );
  });

  it("keeps an attacker-controlled parameter name safe to echo", () => {
    const control = `bad%0akey=1`;
    const details = expectRejected(control);

    expect(details[0].path).toBe("badkey");
    expect(details[0].path).not.toMatch(/[\r\n]/);
  });

  it("truncates a very long parameter name", () => {
    const details = expectRejected(`${"x".repeat(200)}=1`);

    expect(details[0].path).toHaveLength(40);
  });
});

describe("sorting", () => {
  it("reads a leading minus as descending", () => {
    expect(query("sort=-name").sort).toEqual({ name: -1, _id: 1 });
  });

  it("reads a bare field as ascending", () => {
    expect(query("sort=name").sort).toEqual({ name: 1, _id: 1 });
  });

  it("accepts several fields, most significant first", () => {
    expect(query("sort=-updatedAt,name").sort).toEqual({
      updatedAt: -1,
      name: 1,
      _id: 1,
    });
  });

  it("supports the explicit sortBy and sortDir form", () => {
    expect(query("sortBy=name&sortDir=desc").sort).toEqual({
      name: -1,
      _id: 1,
    });
    expect(query("sortBy=name").sort).toEqual({ name: 1, _id: 1 });
  });

  it("rejects a field that is not sortable by this resource", () => {
    expect(expectRejected("sort=email").map((d) => d.path)).toContain("sort");
  });

  it.each([
    ["sort=$orderby", "a leading dollar"],
    ["sort=profile.email", "a dotted path"],
    ["sortBy=profile.email", "a dotted path in the explicit form"],
  ])("rejects %s (%s)", (search) => {
    expectRejected(search);
  });

  it("rejects sort and sortBy together rather than picking one", () => {
    // A bookmarked URL gaining a second form must not silently reorder.
    expect(
      expectRejected("sort=name&sortBy=name").map((d) => d.path),
    ).toContain("sort");
  });

  it("rejects sortDir without sortBy", () => {
    expect(expectRejected("sortDir=desc").map((d) => d.path)).toContain(
      "sortDir",
    );
  });

  it("rejects a sortDir that is neither asc nor desc", () => {
    expectRejected("sortBy=name&sortDir=sideways");
  });

  it("adds _id as a tiebreaker because offset paging needs a total order", () => {
    // Two contacts created in the same millisecond are otherwise free to swap
    // places between page requests, so row 20 of page 1 reappears on page 2.
    expect(query("sort=-createdAt").sort._id).toBe(1);
  });

  it("does not add a second _id entry when the caller sorts by it", () => {
    const result = contacts.parse(new URLSearchParams("sort=-_id"));
    expect(Object.keys(result.sort)).toEqual(["_id"]);
    expect(result.sort._id).toBe(-1);
  });

  it("treats an empty sort as absent", () => {
    expect(query("sort=").sort).toEqual({ createdAt: -1, _id: 1 });
  });

  it("rejects a default sort the allow-list does not cover", () => {
    // Otherwise every request to the endpoint fails with a message naming a
    // field the caller never sent.
    expect(() =>
      listQuery({ filters, sortable: ["name"], defaultSort: "-createdAt" }),
    ).toThrow(/defaultSort field "createdAt" is not in sortable/);
  });

  it("accepts a default sort that is in the allow-list", () => {
    expect(() =>
      listQuery({ filters, sortable: ["name", "createdAt"] }),
    ).not.toThrow();
  });

  it("validates every field of a multi-field default sort", () => {
    expect(() =>
      listQuery({
        filters,
        sortable: ["name"],
        defaultSort: "-createdAt,name",
      }),
    ).toThrow(/createdAt/);
  });

  it("rejects a bad allow-list at construction, not per request", () => {
    // The check belongs here so a mistake is a startup failure rather than a
    // 422 that only shows up for whoever pages that column first.
    expect(() => listQuery({ filters, sortable: ["profile.email"] })).toThrow(
      /bare field name/,
    );
    expect(() => listQuery({ filters, sortable: ["$where"] })).toThrow(
      /bare field name/,
    );
  });
});

describe("search", () => {
  it("trims the term", () => {
    const result = query("q=%20%20acme%20%20");

    expect(result.q).toBe("acme");
    expect(result.pattern?.test("Acme Corp")).toBe(true);
  });

  it("treats an empty term as no search", () => {
    // The pattern for "" matches every document, which is a slow way to ask
    // for the collection and the wrong reading of an empty search box.
    const result = query("q=");

    expect(result.q).toBeUndefined();
    expect(result.pattern).toBeUndefined();
  });

  it("rejects a term over the documented length", () => {
    expectRejected(`q=${"a".repeat(MAX_SEARCH_LENGTH + 1)}`);
  });

  it("accepts a term exactly at the limit", () => {
    expect(query(`q=${"a".repeat(MAX_SEARCH_LENGTH)}`).q).toHaveLength(
      MAX_SEARCH_LENGTH,
    );
  });

  it("matches the term literally rather than as a pattern", () => {
    const result = query("q=.*");

    expect(result.pattern?.test(".*")).toBe(true);
    expect(result.pattern?.test("anything")).toBe(false);
  });

  it("cannot be used to make an expensive pattern", () => {
    // Unescaped, this is a catastrophic-backtracking pattern. Escaped, it is a
    // literal search for the characters "(a+)+$".
    const result = query("q=(a%2B)%2B%24");

    expect(result.pattern?.source).toBe("\\(a\\+\\)\\+\\$");
    expect(result.pattern?.test("(a+)+$")).toBe(true);
  });

  it("escapes the characters that would otherwise change the pattern", () => {
    expect(escapeRegExp("a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o/p-q")).toBe(
      "a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o\\/p\\-q",
    );
  });

  it("builds a case-insensitive pattern", () => {
    expect(searchPattern("acme").flags).toContain("i");
  });

  it("rejects q on a resource that cannot be searched", () => {
    const pipelines = listQuery({
      filters,
      sortable: ["name", "createdAt"],
      searchable: false,
    });

    expect(() => pipelines.parse(new URLSearchParams("q=acme"))).toThrow(
      AppError,
    );
  });
});

describe("filters", () => {
  it("parses a resource filter", () => {
    expect(query("status=CUSTOMER&ownerId=u1").filters).toEqual({
      status: "CUSTOMER",
      ownerId: "u1",
    });
  });

  it("parses hasEmail=false as false, not as true", () => {
    // The classic coercion bug: Boolean("false") is true, so a filter that
    // means "contacts with no email" returns the contacts that have one.
    expect(query("hasEmail=false").filters.hasEmail).toBe(false);
    expect(query("hasEmail=true").filters.hasEmail).toBe(true);
    expect(query("hasEmail=0").filters.hasEmail).toBe(false);
    expect(query("hasEmail=1").filters.hasEmail).toBe(true);
  });

  it("accepts every booleanish spelling, and never inverts one", () => {
    // `yes` and `on` are unambiguous to a human, so rejecting them would be
    // pedantry. What matters is that no spelling of false reads as true, which
    // is the coercion bug this test exists to prevent.
    for (const [spelling, expected] of [
      ["true", true],
      ["1", true],
      ["yes", true],
      ["on", true],
      ["false", false],
      ["0", false],
      ["no", false],
      ["off", false],
    ] as const) {
      expect(query(`hasEmail=${spelling}`).filters.hasEmail, spelling).toBe(
        expected,
      );
    }
  });

  it("rejects a value that is not a boolean in any spelling", () => {
    expect(expectRejected("hasEmail=maybe").map((d) => d.path)).toContain(
      "hasEmail",
    );
  });

  it("parses a date filter into a Date", () => {
    const result = query("createdFrom=2026-01-02");
    const from = result.filters.createdFrom;

    expect(from).toBeInstanceOf(Date);
    expect(from?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("accepts a datetime with and without a zone", () => {
    expect(
      query("createdFrom=2026-01-02T10:30:00Z").filters.createdFrom,
    ).toBeInstanceOf(Date);
    expect(
      query("createdFrom=2026-01-02T10:30:00").filters.createdFrom,
    ).toBeInstanceOf(Date);
  });

  it("rejects a date format that new Date would have accepted", () => {
    // `new Date("Jan 2 2026")` is a valid date. A filter that widens on a
    // typo is a filter that is silently wrong.
    expect(
      expectRejected("createdFrom=Jan%202%202026").map((d) => d.path),
    ).toContain("createdFrom");
    expectRejected("createdFrom=1");
    expectRejected("createdFrom=2026-1-2");
  });

  it("rejects a value outside the resource's enum", () => {
    expect(expectRejected("status=ARCHIVED").map((d) => d.path)).toContain(
      "status",
    );
  });

  it("collects a repeated filter into an array", () => {
    expect(query("tag=a&tag=b").filters.tag).toEqual(["a", "b"]);
  });

  it("treats one value for a list filter as a list of one", () => {
    // `?tag=urgent` and `?tag[]=urgent` have to mean the same thing, or the
    // difference is invisible in the documentation.
    expect(query("tag=urgent").filters.tag).toEqual(["urgent"]);
    expect(query("tag[]=urgent").filters.tag).toEqual(["urgent"]);
    expect(query("tag=urgent&tag=vip").filters.tag).toEqual(["urgent", "vip"]);
  });

  it("does not promote a filter that is not a list", () => {
    expect(query("ownerId=u1").filters.ownerId).toBe("u1");
  });

  it("rejects an empty value in an array filter", () => {
    expectRejected("tag[]=a&tag[]=");
  });
});

describe("ordered pairs", () => {
  it("accepts a range in order", () => {
    expect(() =>
      query("createdFrom=2026-01-01&createdTo=2026-02-01"),
    ).not.toThrow();
  });

  it("accepts one end on its own", () => {
    expect(() => query("createdFrom=2026-01-01")).not.toThrow();
  });

  it("rejects an inverted range instead of returning nothing", () => {
    // A from after the to is a request for no rows. Returning an empty page
    // makes that look like the data is gone.
    const details = expectRejected(
      "createdFrom=2026-02-01&createdTo=2026-01-01",
    );

    expect(details).toEqual([
      {
        path: "createdFrom",
        message: "createdFrom must not be greater than createdTo.",
      },
    ]);
  });

  it("rejects an inverted range of equal values only when actually inverted", () => {
    expect(() =>
      query("createdFrom=2026-01-01&createdTo=2026-01-01"),
    ).not.toThrow();
  });

  it("compares numeric ranges too", () => {
    const leads = listQuery({
      filters: z.strictObject({
        scoreMin: z.coerce.number().int().optional(),
        scoreMax: z.coerce.number().int().optional(),
      }),
      sortable: ["score", "createdAt"],
      orderedPairs: [["scoreMin", "scoreMax"]],
    });

    expect(() =>
      leads.parse(new URLSearchParams("scoreMin=10&scoreMax=90")),
    ).not.toThrow();
    expect(() =>
      leads.parse(new URLSearchParams("scoreMin=90&scoreMax=10")),
    ).toThrow(AppError);
  });
});

describe("inputs", () => {
  it("accepts a Next.js searchParams object", () => {
    // App Router hands over `string | string[] | undefined`, not URLSearchParams.
    const result = contacts.parse({
      page: "2",
      pageSize: "10",
      tag: ["a", "b"],
      sort: undefined,
    });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.skip).toBe(10);
    expect(result.filters.tag).toEqual(["a", "b"]);
  });

  it("treats an undefined value as absent, not as an empty string", () => {
    // If undefined became "", page would coerce to 0 and a page with no
    // page param at all would 422.
    expect(contacts.parse({ page: undefined, pageSize: undefined }).page).toBe(
      DEFAULT_PAGE,
    );
  });

  it("does not mutate a params object it was given", () => {
    const params = { tag: ["a"] };
    contacts.parse(params);

    expect(params).toEqual({ tag: ["a"] });
  });

  it("merges a repeated key from a params object and a bracket spelling", () => {
    expect(toQueryRecord({ "tag[]": "a", tag: "b" })).toEqual({
      tag: ["a", "b"],
    });
  });

  it("reports a parameter named __proto__ instead of dropping it", () => {
    // Assigning to `__proto__` on a plain object invokes the prototype setter
    // and stores nothing, so the key would never reach the unknown-parameter
    // check. The record is built with a null prototype to prevent that.
    expect(
      Object.keys(toQueryRecord(new URLSearchParams("__proto__=x"))),
    ).toEqual(["__proto__"]);
    expect(expectRejected("__proto__=x").map((d) => d.path)).toContain(
      "__proto__",
    );
  });

  it("does not pollute a prototype through a parameter name", () => {
    // Rejected as unknown, which is the point: a name that could reach a
    // prototype never gets far enough to be assigned anywhere.
    expect(() => query("__proto__=polluted&page=2")).toThrow(AppError);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("normalises a bracketed URLSearchParams into one array", () => {
    expect(toQueryRecord(new URLSearchParams("tag[]=a&tag[]=b&tag=c"))).toEqual(
      { tag: ["a", "b", "c"] },
    );
  });
});

describe("envelope integration", () => {
  it("produces meta that matches the success envelope shape", () => {
    const result = query("page=2&pageSize=50");

    expect(contacts.meta(result, 0)).toEqual({
      page: 2,
      pageSize: 50,
      total: 0,
      totalPages: 0,
    });
  });
});
