import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The connection module exists so that exactly one place opens a socket, and
 * nothing enforces that.
 *
 * A stray `mongoose.connect()` inside a service or a route handler is not a
 * type error and not a lint error. It reads as correct, it works in the
 * environment its author happens to be testing, and it quietly costs a second
 * connection pool on every serverless instance that reaches it. The bill
 * arrives as an Atlas connection limit under load, long after the commit that
 * caused it, and the diff that introduced it is not a plausible suspect.
 *
 * So the constraint is structural: `src/db/connection.ts` is the only file that
 * may open a connection. Everything else awaits `connectToDatabase()`, which is
 * what makes the caching and the pool sizing mean anything.
 */

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");

/** The one file allowed to open a connection. */
const OWNER = "src/db/connection.ts";

/** Calls that open nothing and so are not a bypass. */
const EXEMPT = [/createConnection\s*\(/];

const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
]);

/**
 * `Model.findByIdAndUpdate(id, ...)` is implemented as
 * `findOneAndUpdate({ _id: id }, ...)` — it *replaces* the filter rather than
 * merging into it. Handing it `{ _id, organizationId }` reads like a scoped
 * update, survives review, and updates another tenant's row. This repository
 * shipped that bug for the length of one test run.
 *
 * The same is true of `findByIdAndDelete`. `findById` alone is safe (it is
 * `findOne({ _id: id })`, so a caller can add conditions) but there is no
 * reason to use it when the filter is a single id and the repository already
 * has a scoped equivalent, so all three are listed.
 */
// Mongoose models are PascalCase; repository instances are lower-camel case
// and provide the tenant-scoped equivalent of these methods. Restricting the
// match to model-shaped receivers avoids flagging safe repository calls while
// still catching direct model access such as `ContactModel.findById(...)`.
const UNSAFE_FILTER_METHODS = [
  /\b[A-Z][A-Za-z0-9_]*\s*\.\s*findByIdAndUpdate\s*\(/,
  /\b[A-Z][A-Za-z0-9_]*\s*\.\s*findByIdAndDelete\s*\(/,
  /\b[A-Z][A-Za-z0-9_]*\s*\.\s*findByIdAndReplace\s*\(/,
  /\b[A-Z][A-Za-z0-9_]*\s*\.\s*findById\s*\(/,
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) yield full;
  }
}

function findViolations(root: string): string[] {
  const violations: string[] = [];

  for (const file of walk(join(root, "src"))) {
    const rel = relative(root, file);
    if (rel === OWNER) continue;

    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
        if (EXEMPT.some((pattern) => pattern.test(line))) return;
        if (/\bmongoose\s*\.\s*connect\s*\(/.test(line)) {
          violations.push(`${rel}:${index + 1}`);
          return;
        }
        if (UNSAFE_FILTER_METHODS.some((pattern) => pattern.test(line))) {
          violations.push(`${rel}:${index + 1} (filter-discarding method)`);
        }
      });
  }

  return violations;
}

describe("database connection is centralised", () => {
  it("no file outside the connection module opens a connection", () => {
    expect(findViolations(PROJECT_ROOT)).toEqual([]);
  });

  it("nothing uses a Mongoose method that discards the filter", () => {
    // Asserted separately so the failure names the actual hazard rather than
    // reading as a second connection violation.
    const offenders = findViolations(PROJECT_ROOT).filter((v) =>
      v.includes("filter-discarding"),
    );
    expect(offenders).toEqual([]);
  });

  describe("self-tests", () => {
    const SANDBOX = mkdtempSync(join(tmpdir(), "db-guard-"));

    beforeEach(() => {
      rmSync(join(SANDBOX, "src"), { recursive: true, force: true });
      mkdirSync(join(SANDBOX, "src"), { recursive: true });
    });

    afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

    it("catches a bypass in a service", () => {
      writeFileSync(
        join(SANDBOX, "src", "contacts.ts"),
        "await mongoose.connect(uri);",
      );

      const violations = findViolations(SANDBOX);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("contacts.ts:1");
    });

    it("catches a bypass inside a route handler", () => {
      writeFileSync(
        join(SANDBOX, "src", "route.ts"),
        ["export const GET = () => {", "  mongoose.connect(uri);", "};"].join(
          "\n",
        ),
      );

      const violations = findViolations(SANDBOX);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("route.ts:2");
    });

    it("does not flag the connection module itself", () => {
      mkdirSync(join(SANDBOX, "src", "db"), { recursive: true });
      writeFileSync(
        join(SANDBOX, OWNER),
        "await mongoose.connect(uri, options);",
      );

      expect(findViolations(SANDBOX)).toEqual([]);
    });

    it("catches a filter-discarding update", () => {
      writeFileSync(
        join(SANDBOX, "src", "deals.ts"),
        "await Deal.findByIdAndUpdate({ _id, organizationId }, { $set: deal });",
      );

      const violations = findViolations(SANDBOX);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("filter-discarding");
    });

    it("catches findById, which is only safe by accident", () => {
      writeFileSync(
        join(SANDBOX, "src", "tasks.ts"),
        "await Task.findById(id);",
      );

      expect(findViolations(SANDBOX)).toHaveLength(1);
    });

    it("ignores createConnection, which opens a different thing", () => {
      writeFileSync(
        join(SANDBOX, "src", "fixtures.ts"),
        "const test = createConnection(uri);",
      );

      expect(findViolations(SANDBOX)).toEqual([]);
    });

    it("ignores the call when it only appears in documentation", () => {
      writeFileSync(
        join(SANDBOX, "src", "README.ts"),
        [
          "// Bad: mongoose.connect(uri) here costs a second pool.",
          " * Call mongoose.connect(uri) directly and you leak sockets.",
        ].join("\n"),
      );

      expect(findViolations(SANDBOX)).toEqual([]);
    });
  });
});

/**
 * Irreversible deletes are the one thing in the repository that cannot be
 * undone, so they are named to be greppable. This asserts the set of
 * destructive method declarations rather than the set of calls: it is a
 * structural check on the base class, so it holds for every collection that
 * extends it, including ones that do not exist yet.
 */
const DESTRUCTIVE_DECLARATION =
  /^\s*(?:async\s+)?(softDelete\w*|hardDelete\w*|delete\w*|deleteBy\w*)\s*\(/;

const ALLOWED_DESTRUCTIVE_METHODS = new Set([
  "softDeleteById",
  "softDeleteByIds",
  "softDeleteOne",
  "softDeleteMany",
  "hardDeleteById",
  "hardDeleteMany",
  "deleteOne",
  "deleteMany",
]);

describe("irreversible deletes are named", () => {
  const source = readFileSync(
    join(PROJECT_ROOT, "src", "db", "tenant-repository.ts"),
    "utf8",
  );

  const declared = [
    ...source.matchAll(new RegExp(DESTRUCTIVE_DECLARATION, "gm")),
  ]
    .map((match) => match[1])
    .filter((name) => name !== undefined);

  it("the base class declares no ambiguous delete method", () => {
    // A plain `deleteById` or `deleteOne` that is not the guarded `deleteOne`
    // below is the regression this exists to catch. It previously called
    // findOneAndDelete with no soft-delete check, so a soft-delete collection
    // lost rows that deleteOne and deleteMany both refuse to remove.
    expect(
      declared.filter((name) => !ALLOWED_DESTRUCTIVE_METHODS.has(name)),
    ).toEqual([]);
  });

  it("declares no `deleteById` at all", () => {
    expect(declared).not.toContain("deleteById");
  });

  it("still finds what it is looking for, so the guard is not vacuous", () => {
    // A regex that silently matches nothing would pass every assertion above.
    expect(declared).toContain("hardDeleteById");
    expect(declared).toContain("deleteOne");
  });
});
