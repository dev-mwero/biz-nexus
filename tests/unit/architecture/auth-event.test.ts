import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The authentication event log is append-only, global, and closed.
 *
 * ADR-0006 requires this file to be a *mirror* of
 * `tests/unit/architecture/audit-log.test.ts` rather than a shared helper, and the
 * duplication is the point: a shared `assertAppendOnly(modelName)` would be one
 * edit away from asserting both collections at once, and a property checked for
 * one collection only is not a property of either. So the scan is written out
 * twice. The differences are deliberate and commented — this one includes
 * `src/app`, because the six route handlers under `src/app/api/v1/auth` are where
 * a mutation would actually be written, and the `audit-log` test excludes that
 * tree because `audit_logs` has no route handlers writing to it.
 *
 * It also carries the four schema-constraint assertions, because those are
 * statements about absences in the same schema and belong beside the append-only
 * checks they are about.
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

/** Unlike the `audit-log` copy, `src/app` is included. */
const files = sourceFiles(SRC);

/**
 * Source with comments removed.
 *
 * Without this the scan reports its own documentation: a comment explaining that
 * `auth_events` has no `metadata` mentions `metadata`, and a comment warning
 * against `AuthEventModel.updateOne` would satisfy the check that none exists. A
 * rule that fails when somebody writes *about* the rule instead of when they
 * break it gets switched off.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MODEL = "AuthEventModel";
const MODEL_FILE = join("modules", "audit", "auth-event.model.ts");
const SERVICE_FILE = join("modules", "audit", "auth-event.service.ts");
const modelSource = stripComments(readFileSync(join(SRC, MODEL_FILE), "utf8"));

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

describe("the auth event log is append-only", () => {
  it("has source files to check", () => {
    // A scan that silently matched nothing would pass every assertion below.
    expect(files.length).toBeGreaterThan(20);
    // `src/app` included: this is the assertion the mirrored test cannot make.
    expect(files.some((file) => file.includes(join("src", "app")))).toBe(true);
  });

  it("has no code path that updates or deletes an auth event row", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const method of MUTATORS) {
        if (source.includes(`${MODEL}.${method}`)) {
          offenders.push(
            `${file.replace(`${SRC}/`, "")} calls ${MODEL}.${method}`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("is not given timestamps that would invite an update", () => {
    // An `updatedAt` on an append-only collection says the document is expected
    // to change, which is the belief this schema exists to contradict.
    expect(modelSource).toMatch(/updatedAt:\s*false/);
    // `timestamps: true` as a bare option adds updatedAt by default.
    expect(modelSource).not.toMatch(/timestamps:\s*true/);
    expect(modelSource).not.toMatch(/"timestamps"\s*:\s*true/);
  });

  it("has no soft-delete mixin on the model", () => {
    // Matched as a bare identifier, not as the literal text `softDelete()`:
    // the schema option is written `softDelete: () => {}`, and a check for the
    // call syntax passes straight past the thing it was written to forbid.
    expect(modelSource).not.toMatch(/softDelete/);
    expect(modelSource).not.toMatch(/deletedAt/);
  });

  it("writes only through recordAuthEvent", () => {
    const directWrites: string[] = [];

    for (const file of files) {
      if (file.endsWith(MODEL_FILE)) continue;
      if (file.endsWith(SERVICE_FILE)) continue;

      const source = stripComments(readFileSync(file, "utf8"));
      // A `create` on the model from anywhere else is a row that skipped the
      // drop policy, and therefore a row whose loss nobody would hear about.
      if (source.includes(`${MODEL}.create`)) {
        directWrites.push(file.replace(`${SRC}/`, ""));
      }
    }

    expect(directWrites).toEqual([]);
  });

  it("does not export a repository that would offer an update path", () => {
    const barrel = stripComments(
      readFileSync(join(SRC, "modules/audit/index.ts"), "utf8"),
    );

    // A tenant repository for auth_events would be a general-purpose
    // update-and-delete handle on a global collection, and it would also have to
    // invent an `organizationId` to scope by, which is the one field this
    // collection must not have.
    expect(barrel).not.toContain("Repository");
  });
});

describe("the auth event log is global", () => {
  it("carries no organisation reference of any kind", () => {
    // Not a nullable field. Not a field that is never set. No field. The absence
    // is the mechanism, and it is the one thing here that a later edit can
    // plausibly undo by accident.
    expect(modelSource).not.toMatch(/organizationId/);
  });

  it("declares no index that scopes by organisation", () => {
    const indexes = modelSource.match(/index\([^)]*\{([^}]*)\}/g) ?? [];
    const scoping = indexes.filter((index) => index.includes("organizationId"));
    expect(scoping).toEqual([]);
  });
});

describe("the auth event log is closed", () => {
  it("constrains action to a server-side enum", () => {
    // `audit_logs` declares `action: { type: String, required: true }` with no
    // enum, so a caller typo becomes a row nothing queries. This collection will
    // not repeat it — and it matters more here, because a write here is permitted
    // to fail, so a constraint that rejects a caller value is the difference
    // between a dropped row and a 500.
    expect(modelSource).toMatch(/action:\s*\{[\s\S]*?enum:/);
    expect(modelSource).toMatch(/required:\s*true[\s\S]*?enum:/);
  });

  it("has no field that accepts arbitrary content", () => {
    // The single most important control in the schema. The caller-triggered
    // rejection hazard *requires* a field that takes arbitrary content, and
    // `audit_logs` has two. With no `Mixed` and no `Object`-typed path there is
    // nothing left to put a wrong shape into, so the hazard is unreachable by
    // construction rather than unlikely.
    expect(modelSource).not.toMatch(/Mixed/);
    expect(modelSource).not.toMatch(/Schema\.Types\.Object\b(?!Id)/);
    expect(modelSource).not.toMatch(/type:\s*Object\b/);
    expect(modelSource).not.toMatch(/changes/);
    expect(modelSource).not.toMatch(/metadata/);
  });

  it("truncates rather than validating the untrusted strings", () => {
    // `maxlength` would refuse the sign-in the row was going to describe, over a
    // header the client controls.
    expect(modelSource).toMatch(/ip:[\s\S]*?set: truncate/);
    expect(modelSource).toMatch(/userAgent:[\s\S]*?set: truncate/);
    expect(modelSource).toMatch(/email:[\s\S]*?set: truncate/);
    expect(modelSource).not.toMatch(/maxlength/);
  });

  it("bounds email, ip and user agent with the limits it states", async () => {
    const { AUTH_EVENT_MAX_EMAIL } = await import(
      "@/modules/audit/auth-event.model"
    );
    const { SESSION_MAX_IP, SESSION_MAX_USER_AGENT } = await import(
      "@/modules/identity/session.model"
    );

    expect(AUTH_EVENT_MAX_EMAIL).toBe(254);
    // The event log reuses the session's limits rather than inventing its own.
    expect(modelSource).toMatch(/set: truncate\(SESSION_MAX_IP\)/);
    expect(modelSource).toMatch(/set: truncate\(SESSION_MAX_USER_AGENT\)/);
    expect(SESSION_MAX_IP).toBeGreaterThan(0);
    expect(SESSION_MAX_USER_AGENT).toBeGreaterThan(0);
  });

  it("writes a 90-day TTL on a named constant, not an env var", async () => {
    const { AUTH_EVENT_TTL_DAYS } = await import(
      "@/modules/audit/auth-event.model"
    );

    expect(AUTH_EVENT_TTL_DAYS).toBe(90);
    expect(modelSource).toMatch(/expireAfterSeconds: AUTH_EVENT_TTL_DAYS/);
    // A retention period that configuration can change is a retention period
    // nobody has decided, and the TTL is the one index here that deletes live
    // records, so its period is the number this repository has to be able to
    // state in docs/DATABASE.md §8.
    expect(modelSource).not.toMatch(/expireAfterSeconds:\s*env/);
    expect(modelSource).not.toMatch(/expireAfterSeconds:\s*\d/);
  });
});

describe("the auth event log holds its write-failure policy", () => {
  const service = stripComments(readFileSync(join(SRC, SERVICE_FILE), "utf8"));

  it("never throws out of recordAuthEvent", () => {
    // Every failure — including a caller-supplied value that violates a
    // constraint — becomes a log line and a `null`. A `throw` anywhere on this
    // path is the bug ADR-0006 argues the polarity exists to prevent.
    expect(service).not.toMatch(/\bthrow\b/);
    expect(service).toMatch(/catch/);
    expect(service).toMatch(/return null/);
  });

  it("emits exactly one error line, carrying the greppable literal", () => {
    expect(service).toMatch(/console\.error/);
    expect(service).toMatch(/event: "auth_event_write_failed"/);
    // Never demoted to `info`, where nobody is looking, and never swallowed by a
    // catch that downgrades it.
    expect(service).not.toMatch(/console\.info/);
    expect(service).not.toMatch(/console\.warn/);
  });

  it("carries the request's own requestId, for correlation", () => {
    // This is what converts "absence is ambiguous" into a per-request answer for
    // an operator holding an id a user has quoted.
    expect(service).toMatch(/requestId: input\.requestId/);
  });

  it("is never enlisted in a caller's transaction", () => {
    // There is no session parameter to pass, so the hazard is closed by the
    // signature rather than by discipline. A rejected event write inside a
    // transaction would roll back the primary work and fail the request, which is
    // precisely the outcome the drop policy exists to prevent.
    expect(service).not.toMatch(/session/);
  });

  it("does not take a transaction helper that could enlist it", () => {
    expect(service).not.toMatch(/withTransaction/);
  });
});
