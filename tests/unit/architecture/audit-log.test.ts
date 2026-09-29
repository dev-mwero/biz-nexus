import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The audit log is append-only, and the guarantee is the absence of code.
 *
 * There is no update method, no delete method, and no soft-delete field on this
 * collection, and no service is permitted to add one. Nothing in the type system
 * can express the absence of a method, so the rule is checked the only way an
 * absence can be: by reading the source and asserting the mutation calls are not
 * there.
 *
 * This is a source scan rather than a runtime test on purpose. A test that
 * called `updateOne` and asserted it did not work would be testing mongoose.
 * This one fails the moment somebody writes the call, which is the moment it
 * matters.
 */

const SRC = resolve(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry)) return [];
    // Fixtures and type-only declarations are not the service surface.
    if (/\.d\.ts$/.test(entry)) return [];
    return [full];
  });
}

const files = sourceFiles(SRC).filter(
  (file) => !file.includes(`${join("src", "app")}`),
);

/**
 * Source with comments removed.
 *
 * Without this the scan reports its own documentation: a comment explaining why
 * the model has no `updatedAt` mentions `timestamps: true`, and a comment
 * warning against `AuditLogModel.updateOne` would satisfy the check that no
 * `AuditLogModel.updateOne` exists. A rule that fails when somebody writes
 * about the rule, instead of when they break it, gets switched off.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MUTATORS = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findByIdAndUpdate",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
  "findByIdAndDelete",
  "remove",
];

describe("the audit log is append-only", () => {
  it("has source files to check", () => {
    // A scan that silently matched nothing would pass every assertion below.
    expect(files.length).toBeGreaterThan(20);
  });

  it("has no code path that updates or deletes an audit row", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const method of MUTATORS) {
        if (source.includes(`AuditLogModel.${method}`)) {
          offenders.push(
            `${file.replace(`${SRC}/`, "")} calls AuditLogModel.${method}`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("is not given timestamps that would invite an update", () => {
    const model = stripComments(
      readFileSync(join(SRC, "modules/audit/audit-log.model.ts"), "utf8"),
    );

    // An `updatedAt` on an append-only collection says the document is expected
    // to change, which is the belief this schema exists to contradict.
    expect(model).toMatch(/updatedAt:\s*false/);
    // `timestamps: true` as a bare option adds updatedAt by default.
    expect(model).not.toMatch(/timestamps:\s*true/);
    expect(model).not.toMatch(/"timestamps"\s*:\s*true/);
  });

  it("has no soft-delete mixin on the model", () => {
    const model = stripComments(
      readFileSync(join(SRC, "modules/audit/audit-log.model.ts"), "utf8"),
    );

    // Matched as a bare identifier, not as the literal text `softDelete()`:
    // the schema option is written `softDelete: () => {}`, and a check for the
    // call syntax passes straight past the thing it was written to forbid.
    expect(model).not.toMatch(/softDelete/);
    expect(model).not.toMatch(/deletedAt/);
  });

  it("writes only through recordAction", () => {
    const directWrites: string[] = [];

    for (const file of files) {
      if (file.endsWith(join("audit", "audit-log.model.ts"))) continue;
      if (file.endsWith(join("audit", "audit.service.ts"))) continue;

      const source = stripComments(readFileSync(file, "utf8"));
      // A `create` on the model from anywhere else is a row that skipped the
      // diff, and therefore a row that is not trustworthy.
      if (source.includes("AuditLogModel.create")) {
        directWrites.push(file.replace(`${SRC}/`, ""));
      }
    }

    expect(directWrites).toEqual([]);
  });

  it("does not export a repository that would offer an update path", () => {
    const barrel = stripComments(
      readFileSync(join(SRC, "modules/audit/index.ts"), "utf8"),
    );

    // A tenant repository for audit_logs would be a general-purpose
    // update-and-delete handle on an append-only collection, and
    // `TenantRepository` offers exactly that.
    expect(barrel).not.toContain("Repository");
  });
});
