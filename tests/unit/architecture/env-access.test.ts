import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The env module is only authoritative if nothing bypasses it.
 *
 * `process.env.X` is always readable, always untyped, and absent in production
 * if someone forgot to set it — which is the exact failure this module was
 * written to prevent. A lint rule cannot express "use `env` instead of
 * `process.env`" without also flagging the one file that must read it, so the
 * rule lives here instead.
 *
 * This is a test rather than a comment because a comment is not a constraint.
 */

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");

/**
 * Files permitted to touch `process.env`, and which variables.
 *
 * `env.ts` is the module that exists to read it. `instrumentation.ts` is
 * allowed exactly one variable — `NEXT_RUNTIME`, which Next injects and which
 * is the documented way to keep server-only code out of the edge bundle. It is
 * listed narrowly rather than exempted wholesale, so a second `process.env`
 * read added to that file is still a violation.
 */
const ALLOWED: Record<string, string[]> = {
  "src/env.ts": ["*"],
  "src/instrumentation.ts": ["NEXT_RUNTIME"],
};

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

function resolveAllowance(
  rel: string,
  allowlist: Record<string, string[]>,
): string[] | null {
  if (allowlist[rel]) return allowlist[rel];
  // Sandbox files are named after the entry they mirror, e.g. src/env.ts.
  const suffix = Object.keys(allowlist).find((key) => rel.endsWith(`/${key}`));
  return suffix ? (allowlist[suffix] as string[]) : null;
}

/**
 * Returns every disallowed `process.env` read in `sourceDir` as
 * `path:line  text`. Comments are skipped, because prose about `process.env` is
 * documentation rather than a violation.
 */
function findViolations(
  sourceDir: string,
  allowlist: Record<string, string[]> = ALLOWED,
): string[] {
  const violations: string[] = [];

  for (const file of walk(sourceDir)) {
    const rel = relative(PROJECT_ROOT, file);
    const permitted = resolveAllowance(rel, allowlist);

    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
        if (!line.includes("process.env")) return;

        const key = line.match(/process\.env\.([A-Z_][A-Z0-9_]*)/)?.[1] ?? "";
        if (
          permitted?.includes("*") ||
          permitted?.some((p) => key.startsWith(p))
        ) {
          return;
        }

        violations.push(`${rel}:${index + 1}  ${trimmed}`);
      });
  }

  return violations;
}

const SANDBOX = join(PROJECT_ROOT, ".env-guard-sandbox");

describe("environment access", () => {
  beforeEach(() => {
    // Each self-test writes files that the next one would otherwise trip over.
    rmSync(SANDBOX, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(SANDBOX, { recursive: true, force: true });
  });

  it("routes every process.env read through src/env.ts", () => {
    // Bypassing the module means a variable can be unset in production with no
    // error at build time and no error at boot — it just becomes undefined at
    // the point of use, which may be a request weeks later.
    expect(findViolations(join(PROJECT_ROOT, "src"), ALLOWED)).toEqual([]);
  });

  it("flags a direct read in a component", () => {
    // Proves the guard can fail. A check that has never rejected anything is
    // indistinguishable from a check that is not running.
    // Mirrors src/ so the allowlist is resolved by suffix, as in the real tree.
    mkdirSync(join(SANDBOX, "src", "components"), { recursive: true });
    writeFileSync(
      join(SANDBOX, "src", "components", "sneaky.tsx"),
      [
        "export const uri = process.env.MONGODB_URI;",
        "// process.env in a comment is documentation, not a violation.",
        "export const fine = 1;",
      ].join("\n"),
    );

    const violations = findViolations(SANDBOX, {});

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("sneaky.tsx:1");
    expect(violations[0]).toContain("process.env.MONGODB_URI");
  });

  it("honours the allowlist", () => {
    mkdirSync(join(SANDBOX, "src"), { recursive: true });
    writeFileSync(
      join(SANDBOX, "src", "env.ts"),
      "export const raw = process.env.SESSION_SECRET;",
    );

    expect(findViolations(SANDBOX)).toEqual([]);
  });

  it("rejects an unlisted variable in a partially allowed file", () => {
    // instrumentation.ts may read NEXT_RUNTIME and nothing else. A blanket
    // exemption would let the server-only env leak into the edge bundle.
    mkdirSync(join(SANDBOX, "src"), { recursive: true });
    writeFileSync(
      join(SANDBOX, "src", "instrumentation.ts"),
      [
        'if (process.env.NEXT_RUNTIME === "nodejs") {}',
        "const secret = process.env.SESSION_SECRET;",
      ].join("\n"),
    );

    const violations = findViolations(SANDBOX);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("SESSION_SECRET");
  });
});
