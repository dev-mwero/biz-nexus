import { Types } from "mongoose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import {
  AUDIT_ACTIONS,
  type AuditLog,
  AuditLogModel,
  diffRecords,
  recordAction,
} from "@/modules/audit";
import { REDACTED } from "@/shared/lib/redact";

/**
 * The audit log.
 *
 * "stage changes and settings edits recorded" is the acceptance criterion, but
 * the thing worth testing is what ends up *in* the row: a diff that lists a
 * field nobody changed makes the log a wall of noise, and a diff that omits one
 * somebody changed is worse than no log at all. So most of these are about the
 * diff being exactly the difference and nothing more.
 */

const org = new Types.ObjectId();
const actor = { id: new Types.ObjectId(), name: "Ada Lovelace" };
const entityId = new Types.ObjectId();

const SYSTEM = "System";

describe("diffRecords", () => {
  it("records only the field that changed", () => {
    const changes = diffRecords(
      { name: "Acme", status: "LEAD", ownerId: "u1" },
      { name: "Acme", status: "CUSTOMER", ownerId: "u1" },
    );

    expect(changes).toEqual({
      before: { status: "LEAD" },
      after: { status: "CUSTOMER" },
    });
  });

  it("records nothing for two identical records", () => {
    const record = { name: "Acme", nested: { a: 1 } };

    expect(diffRecords(record, { ...record })).toEqual({
      before: {},
      after: {},
    });
  });

  it("ignores fields nobody could have changed", () => {
    // `_id`, timestamps and audit fields change on their own. Listing them
    // would mean every row claimed the record was edited by everyone, always.
    const changes = diffRecords(
      {
        _id: "a",
        name: "Acme",
        createdAt: new Date("2020-01-01"),
        updatedAt: new Date("2020-01-01"),
        createdBy: "u0",
        updatedBy: "u0",
        deletedAt: null,
      },
      {
        _id: "b",
        name: "Acme",
        createdAt: new Date("2024-06-06"),
        updatedAt: new Date("2024-06-06"),
        createdBy: "u0",
        updatedBy: "u1",
        deletedAt: new Date(),
      },
    );

    expect(changes).toEqual({ before: {}, after: {} });
  });

  it("does not treat a rebuilt Date as a change", () => {
    const changes = diffRecords(
      { dueAt: new Date("2026-03-04T10:00:00.000Z") },
      { dueAt: new Date("2026-03-04T10:00:00.000Z") },
    );

    expect(changes).toEqual({ before: {}, after: {} });
  });

  it("does not treat a rebuilt ObjectId as a change", () => {
    const before = new Types.ObjectId("64f000000000000000000001");
    const after = new Types.ObjectId("64f000000000000000000001");

    expect(diffRecords({ companyId: before }, { companyId: after })).toEqual({
      before: {},
      after: {},
    });
  });

  it("records an ObjectId change as a hex string, so both sides read the same", () => {
    const changes = diffRecords(
      { companyId: new Types.ObjectId("64f000000000000000000001") },
      { companyId: new Types.ObjectId("64f000000000000000000002") },
    );

    // Not `ObjectId('…')` on one side. A diff that prints the same id
    // differently on each side reads as a change to something unrelated.
    expect(changes).toEqual({
      before: { companyId: "64f000000000000000000001" },
      after: { companyId: "64f000000000000000000002" },
    });
  });

  it("records a real Date change as an ISO string", () => {
    const changes = diffRecords(
      { dueAt: new Date("2026-03-04T10:00:00.000Z") },
      { dueAt: new Date("2026-03-05T10:00:00.000Z") },
    );

    expect(changes.after.dueAt).toBe("2026-03-05T10:00:00.000Z");
  });

  it("does not record a deep change inside a field whose value is the unit", () => {
    // Shallow by design: a settings blob is one field, and per-key diffing
    // inside arbitrary Mixed has no principled stopping point.
    const changes = diffRecords(
      { settings: { timezone: "UTC", weekStartsOn: 1 } },
      { settings: { timezone: "Europe/London", weekStartsOn: 1 } },
    );

    expect(Object.keys(changes.after)).toEqual(["settings"]);
    expect(changes.after.settings).toEqual({
      timezone: "Europe/London",
      weekStartsOn: 1,
    });
  });

  it("does not record a deeply equal nested object as changed", () => {
    const changes = diffRecords(
      { settings: { a: { b: [1, 2, 3] } } },
      { settings: { a: { b: [1, 2, 3] } } },
    );

    expect(changes).toEqual({ before: {}, after: {} });
  });

  it("records a removed field as null on the after side", () => {
    // A missing key would be indistinguishable from a field that was never
    // there, which for an audit trail is the difference between "this was
    // removed" and "nothing happened".
    const changes = diffRecords(
      { name: "Acme", phone: "+254700000000" },
      {
        name: "Acme",
      },
    );

    expect(changes).toEqual({
      before: { phone: "+254700000000" },
      after: { phone: null },
    });
  });

  it("records an added field as null on the before side", () => {
    const changes = diffRecords(
      { name: "Acme" },
      {
        name: "Acme",
        phone: "+254700000000",
      },
    );

    expect(changes).toEqual({
      before: { phone: null },
      after: { phone: "+254700000000" },
    });
  });

  it("records every field for a create", () => {
    const changes = diffRecords(null, { name: "Acme", status: "LEAD" });

    expect(changes).toEqual({
      before: { name: null, status: null },
      after: { name: "Acme", status: "LEAD" },
    });
  });

  it("records every field for a delete", () => {
    const changes = diffRecords({ name: "Acme" }, null);

    expect(changes).toEqual({
      before: { name: "Acme" },
      after: { name: null },
    });
  });

  it("never writes a secret into a diff", () => {
    // The row is never deleted, so a credential written here is a credential at
    // rest forever, in the collection people browse to find out who did what.
    const changes = diffRecords(
      { email: "a@example.com", password: "old-hash" },
      { email: "b@example.com", password: "new-hash", token: "abc123" },
    );

    const serialised = JSON.stringify(changes);
    expect(serialised).not.toMatch(/old-hash|new-hash|abc123/);
    expect(changes.after.password).toBe(REDACTED);
    expect(changes.after.token).toBe(REDACTED);
    // The key stays, so the row shows that one of these changed.
    expect(changes.after).toHaveProperty("password");
  });

  it("redacts a secret nested inside a changed field", () => {
    const changes = diffRecords(
      { profile: { passwordResetToken: "reset-me" } },
      { profile: { passwordResetToken: "reset-me-too" } },
    );

    expect(JSON.stringify(changes)).not.toMatch(/reset-me/);
  });

  it("redacts a secret in a field that was removed", () => {
    const changes = diffRecords({ apiKey: "sk-live-1" }, {});

    expect(JSON.stringify(changes)).not.toMatch(/sk-live-1/);
    expect(changes.before.apiKey).toBe(REDACTED);
  });
});

describe("recordAction", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  beforeEach(async () => {
    // The audit log is append-only, so the only way to clear it between tests
    // is to delete rows - which is exactly what the architecture test forbids
    // in src. A test reaching for the model directly is the right way round:
    // the rule is about the service's surface, not about the collection.
    await AuditLogModel.deleteMany({});
  });

  it("writes a stage change with only the stage that moved", async () => {
    const before = {
      name: "Renewal",
      stageId: new Types.ObjectId("64f00000000000000000000a"),
      value: 1000,
    };
    const after = {
      name: "Renewal",
      stageId: new Types.ObjectId("64f00000000000000000000b"),
      value: 1000,
    };

    const row = await recordAction({
      organizationId: org,
      actor,
      action: `${"deal"}.${AUDIT_ACTIONS.STAGE_CHANGE}`,
      entityType: "deal",
      entityId,
      entityLabel: "Renewal",
      before,
      after,
    });

    expect(row.changes).toEqual({
      before: { stageId: "64f00000000000000000000a" },
      after: { stageId: "64f00000000000000000000b" },
    });
    expect(row.action).toBe("deal.stage_change");
  });

  it("writes a settings edit", async () => {
    const row = await recordAction({
      organizationId: org,
      actor,
      action: AUDIT_ACTIONS.SETTINGS_UPDATE,
      entityType: "organization",
      entityId: org,
      entityLabel: "Acme",
      before: { timezone: "UTC", weekStartsOn: 1 },
      after: { timezone: "Europe/London", weekStartsOn: 1 },
    });

    // Only the timezone moved. `weekStartsOn` is unchanged, and a settings edit
    // that recorded every field of the settings object would bury the one
    // somebody actually changed.
    expect(row.changes).toEqual({
      before: { timezone: "UTC" },
      after: { timezone: "Europe/London" },
    });
    expect(row.entityType).toBe("organization");
  });

  it("keeps the actor's name on the row", async () => {
    const row = await recordAction({
      organizationId: org,
      actor,
      action: "contact.create",
      entityType: "contact",
    });

    // Denormalised: the log has to still read correctly after the user is gone.
    expect(row.actorName).toBe("Ada Lovelace");
    expect(row.actorId).toEqual(actor.id);
  });

  it("records a system action with no actor", async () => {
    const row = await recordAction({
      organizationId: org,
      action: "task.overdue",
      entityType: "task",
    });

    expect(row.actorId).toBeNull();
    expect(row.actorName).toBe(SYSTEM);
  });

  it("defaults a missing actor to System rather than leaving a blank", async () => {
    // A blank in a compliance record is worse than an honest "System".
    const row = await recordAction({
      organizationId: org,
      action: "task.overdue",
      entityType: "task",
    });

    expect(row.actorName).not.toBe("");
    expect(row.actorName).toBe(SYSTEM);
  });

  it("redacts secrets from metadata too", async () => {
    const row = await recordAction({
      organizationId: org,
      actor,
      action: "auth.login",
      entityType: "session",
      metadata: { ip: "10.0.0.1", authorization: "Bearer sk-live-1" },
    });

    expect(JSON.stringify(row.metadata)).not.toMatch(/sk-live-1/);
    expect(row.metadata.ip).toBe("10.0.0.1");
  });

  it("stores no generated id inside the diff", async () => {
    // Mongoose gives a nested subdocument its own `_id`. Inside an audit diff
    // that is a meaningless random value in every row, and one a client has to
    // learn to ignore.
    const row = await recordAction({
      organizationId: org,
      action: "contact.create",
      entityType: "contact",
      after: { name: "Acme" },
    });

    expect(row.changes).toEqual({
      before: { name: null },
      after: { name: "Acme" },
    });
    const lean = await AuditLogModel.findById(row._id).lean();
    expect(JSON.stringify(lean?.changes)).not.toMatch(/_id/);
  });

  it("defaults changes to empty rather than null", async () => {
    const row = await recordAction({
      organizationId: org,
      action: "contact.create",
      entityType: "contact",
    });

    expect(row.changes).toEqual({ before: {}, after: {} });
  });

  it("uses the supplied occurredAt rather than the write time", async () => {
    // A subscriber replaying an event must not backdate it to the replay.
    const happened = new Date("2026-03-04T10:00:00.000Z");

    const row = await recordAction({
      organizationId: org,
      action: "contact.create",
      entityType: "contact",
      occurredAt: happened,
    });

    expect(row.createdAt?.toISOString()).toBe(happened.toISOString());
  });

  it("does not let a later mutation of the caller's object rewrite history", async () => {
    const after = { name: "Acme" };

    const row = await recordAction({
      organizationId: org,
      action: "contact.create",
      entityType: "contact",
      after,
    });

    after.name = "Renamed behind the audit log's back";

    const stored = await AuditLogModel.findById(row._id).lean();
    expect(stored?.changes.after.name).toBe("Acme");
  });

  it("scopes rows by organization", async () => {
    const other = new Types.ObjectId();
    await recordAction({
      organizationId: org,
      action: "contact.create",
      entityType: "contact",
    });
    await recordAction({
      organizationId: other,
      action: "contact.create",
      entityType: "contact",
    });

    expect(await AuditLogModel.countDocuments({ organizationId: org })).toBe(1);
    expect(await AuditLogModel.countDocuments({ organizationId: other })).toBe(
      1,
    );
  });

  it("orders a tenant's log newest first", async () => {
    await recordAction({
      organizationId: org,
      action: "contact.create",
      entityType: "contact",
      occurredAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    await recordAction({
      organizationId: org,
      action: "contact.update",
      entityType: "contact",
      occurredAt: new Date("2026-03-05T00:00:00.000Z"),
    });

    const rows = await AuditLogModel.find({ organizationId: org })
      .sort({ createdAt: -1 })
      .lean();

    expect(rows[0].action).toBe("contact.update");
  });

  it("indexes the three reads the audit screen makes", () => {
    // docs/DATABASE.md section 8 names exactly three. An index nothing queries
    // is write amplification for nothing.
    const indexes = AuditLogModel.schema.indexes().map(([spec]) => spec);

    expect(indexes).toContainEqual({ organizationId: 1, createdAt: -1 });
    expect(indexes).toContainEqual({
      organizationId: 1,
      entityType: 1,
      entityId: 1,
      createdAt: -1,
    });
    expect(indexes).toContainEqual({
      organizationId: 1,
      actorId: 1,
      createdAt: -1,
    });
  });

  it("has no updatedAt, because nothing about a row is expected to change", () => {
    const row = {} as AuditLog;

    expect(Object.keys(AuditLogModel.schema.paths)).toContain("createdAt");
    expect(Object.keys(AuditLogModel.schema.paths)).not.toContain("updatedAt");
    expect(row).toBeDefined();
  });
});
