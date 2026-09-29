import type { Types } from "mongoose";
import {
  type AuditAction,
  type AuditChanges,
  AuditLogModel,
} from "@/modules/audit/audit-log.model";
import { redact } from "@/shared/lib/redact";

/**
 * The audit log writer.
 *
 * `recordAction` is the only way a row gets into this collection, and its second
 * argument is a whole object before and after rather than a list of fields. The
 * caller already has both - it just read the record, changed it, and wrote it -
 * so asking it to enumerate the fields it touched is asking for a second,
 * separately-maintained list that drifts out of sync with the change, and a
 * field that was changed but not listed is a change the audit log does not know
 * about. The diff is computed here, once, where it can be tested.
 */

export interface RecordActionInput {
  organizationId: Types.ObjectId;
  /**
   * Who did it, or null for a system action. `name` is denormalised onto the row
   * so the log still reads correctly after the user is deleted, and a missing
   * name is worse than "System": it is a blank in a compliance record.
   */
  actor?: { id: Types.ObjectId | null; name: string } | null;
  action: AuditAction;
  entityType: string;
  entityId?: Types.ObjectId | null;
  entityLabel?: string | null;
  /** The record before the change. Omit entirely for a create. */
  before?: Record<string, unknown> | null;
  /** The record after the change. Omit entirely for a delete. */
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  /** Set from the event payload, so a subscriber cannot invent a later time. */
  occurredAt?: Date;
}

/**
 * Fields never written to an audit row, whatever the caller passes.
 *
 * `_id`, `createdAt` and friends are excluded by name because they are not
 * changes anybody made. Secrets are excluded by `redact` instead of by name, so
 * a new password-shaped field is covered without anyone remembering to add it
 * here. `_id` is excluded because the entity's id is already on the row as
 * `entityId`, and repeating it inside the diff is noise at best.
 */
const IGNORED_FIELDS = new Set([
  "_id",
  "__v",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "deletedAt",
  "deletedBy",
]);

/**
 * Whether two values are the same for the purposes of a diff.
 *
 * Not `===` and not a stringify. `{ a: 1 }` written back unchanged must not
 * appear as a change, and `new Date(x)` is never `===` to an equal date, and an
 * `ObjectId` rebuilt from the same hex is never `===` either. Everything is
 * normalised to a comparable form first, so all three collapse to the answer
 * they should have.
 */
function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    return false;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  // Two ObjectIds for the same document are never `===`, and an id read back
  // from the database is a new object every time. Without this, re-saving a
  // record without changing it records every foreign key as changed.
  const aHex = hexOf(a);
  const bHex = hexOf(b);
  if (aHex !== null || bHex !== null) return aHex === bHex;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((item, i) => isSameValue(item, b[i]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!isSameValue(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

/** The hex form of an ObjectId, or null for anything that is not one. */
function hexOf(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const maybeId = value as { toHexString?: () => string };
  return typeof maybeId.toHexString === "function"
    ? maybeId.toHexString()
    : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date) return false;
  if (hexOf(value) !== null) return false;
  return true;
}

/**
 * A stable, comparable, storable form of a value.
 *
 * ObjectIds become their hex string and Dates become ISO strings, because a
 * diff that records `ObjectId('64f…')` as a changed value is a diff that shows
 * the same id differently on either side and reads as a change to nothing.
 */
function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const hex = hexOf(value);
  if (hex !== null) return hex;
  if (Array.isArray(value)) return value.map((item) => normalise(item));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalise(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Compares two versions of a record and returns only the fields that differ.
 *
 * Shallow, on purpose. A deep diff has to decide where to stop, and every answer
 * is wrong somewhere: a `settings` blob with a list inside it either produces a
 * wall of per-index entries or a single opaque "settings changed". Shallow
 * records `before.settings` and `after.settings` in full, which is a truthful
 * and readable answer for a field whose value is itself the unit of change. The
 * values are compared deeply, so an untouched nested object is not recorded.
 *
 * A field present in `before` and absent from `after` is recorded as removed,
 * with `null` on the after side. Dropping the key instead would make a deleted
 * field indistinguishable from a field that was never there, which for an audit
 * trail is the difference between "this was removed" and "nothing happened".
 *
 * Both sides are redacted before they are returned. This is the last place that
 * can stop a credential being written, and an audit row is never deleted.
 */
export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): AuditChanges {
  const beforeKeys = before ? Object.keys(before) : [];
  const afterKeys = after ? Object.keys(after) : [];

  const keys = new Set<string>();
  for (const key of beforeKeys) {
    if (!IGNORED_FIELDS.has(key)) keys.add(key);
  }
  for (const key of afterKeys) {
    if (!IGNORED_FIELDS.has(key)) keys.add(key);
  }

  const beforeChange: Record<string, unknown> = {};
  const afterChange: Record<string, unknown> = {};

  for (const key of keys) {
    const hadBefore = before !== null && before !== undefined && key in before;
    const hasAfter = after !== null && after !== undefined && key in after;

    if (hadBefore && hasAfter) {
      if (isSameValue(before?.[key], after?.[key])) continue;
      beforeChange[key] = normalise(before?.[key]);
      afterChange[key] = normalise(after?.[key]);
      continue;
    }
    if (hadBefore) {
      beforeChange[key] = normalise(before?.[key]);
      // Absent on the other side is `null`, not a missing key: the field was
      // removed, and that is a change worth recording as one.
      afterChange[key] = null;
      continue;
    }
    if (hasAfter) {
      beforeChange[key] = null;
      afterChange[key] = normalise(after?.[key]);
    }
  }

  return {
    before: redact(beforeChange) as Record<string, unknown>,
    after: redact(afterChange) as Record<string, unknown>,
  };
}

/**
 * Writes one audit row.
 *
 * Returns the row so a caller can reference it - a settings screen showing "last
 * changed 2 minutes ago" wants the timestamp, and re-querying for it is a race.
 *
 * Throws if the write fails, rather than swallowing it. An audit row that
 * silently did not get written is the exact failure this collection exists to
 * prevent, and a caller that cannot tolerate that should call it from an event
 * subscriber, where the bus isolates the failure - or accept that it has chosen
 * an unaudited action.
 */
export async function recordAction(input: RecordActionInput) {
  const { before, after } = input;

  const [created] = await AuditLogModel.create([
    {
      organizationId: input.organizationId,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? "System",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      entityLabel: input.entityLabel ?? null,
      changes: diffRecords(before, after),
      // Metadata is caller-supplied and lands in a permanent row, so it is
      // redacted on the same terms as the diff.
      metadata: (redact(input.metadata ?? {}) as Record<string, unknown>) ?? {},
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      ...(input.occurredAt ? { createdAt: input.occurredAt } : {}),
    },
  ]);

  return created;
}
