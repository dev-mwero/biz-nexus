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
        }
      });
  }

  return violations;
}

describe("database connection is centralised", () => {
  it("no file outside the connection module opens a connection", () => {
    expect(findViolations(PROJECT_ROOT)).toEqual([]);
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
