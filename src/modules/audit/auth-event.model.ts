import mongoose, { type Model, Schema, type Types } from "mongoose";
import {
  SESSION_MAX_IP,
  SESSION_MAX_USER_AGENT,
} from "@/modules/identity/session.model";

/**
 * The authentication event log.
 *
 * Global and tenant-free. There is no `organizationId` field of any kind — not a
 * nullable one — and that absence is the mechanism rather than an omission:
 * authentication is pre-tenant (a new account has
 * `activeOrganizationId: null` by design, and five of the nine auth endpoints run
 * before any organisation exists), so the tenant-scoped `audit_logs` cannot record
 * the phase of the lifecycle where account takeover happens. See ADR-0006.
 *
 * **Append-only, enforced the same way `audit_logs` is.** No `updatedAt`, no
 * soft-delete field, no `Repository` export in the barrel. `tests/unit/architecture/
 * audit-log.test.ts` asserts that over `audit_logs` and
 * `tests/unit/architecture/auth-event.test.ts` asserts it again over this
 * collection, duplicated rather than shared — a shared helper is one edit away
 * from asserting both at once, which is how a property stops being checked.
 *
 * **The write-failure policy is the mirror image of `recordAction`.** That one
 * throws so a caller cannot silently skip an audit row. This one never throws:
 * a rejected event write is dropped, the request succeeds, and the loss is
 * reported through one `error`-level log line. The polarity is deliberate and is
 * argued in ADR-0006 — an event write ahead of `recordFailedLogin`'s `$inc`,
 * with a throwing policy, would let an adversary who can make this collection
 * reject writes switch account lockout off.
 */

/**
 * How long a row survives. Ninety days, deliberately shorter than the
 * unbounded alternative and deliberately not configurable: a retention period
 * configuration can change is a retention period nobody has decided. A four-for-
 * four precedent for these being constants rather than env vars —
 * `SESSION_TTL_DAYS`, `PASSWORD_RESET_TTL_MINUTES`, `EMAIL_VERIFICATION_TTL_HOURS`
 * and `INVITATION_TTL_DAYS`.
 */
export const AUTH_EVENT_TTL_DAYS = 90;

/**
 * The closed vocabulary. An audit action nobody can enumerate is not queryable,
 * so this is eight constants and not free text.
 *
 * `me`, `verify-email` and `resend-verification` hold none of these and emit
 * nothing. That is a property of the vocabulary rather than an omission in it:
 * there is no `auth.email_verified` to write, because verification is a change of
 * a field rather than an access to the account.
 */
export const AUTH_EVENT_ACTIONS = {
  LOGIN: "auth.login",
  LOGIN_FAILED: "auth.login_failed",
  LOCKOUT: "auth.lockout",
  LOGOUT: "auth.logout",
  LOGOUT_ALL: "auth.logout_all",
  REGISTER: "auth.register",
  PASSWORD_RESET_REQUESTED: "auth.password_reset_requested",
  PASSWORD_RESET_COMPLETED: "auth.password_reset_completed",
} as const;

export type AuthEventAction =
  (typeof AUTH_EVENT_ACTIONS)[keyof typeof AUTH_EVENT_ACTIONS];

/** The eight, as a plain list, for the schema `enum`. */
const AUTH_EVENT_ACTION_VALUES = Object.values(AUTH_EVENT_ACTIONS);

/**
 * Whether the attempted operation succeeded. Always present, because a *failed*
 * sign-in is the event people need and cannot be inferred from an absent row.
 *
 * `authenticateWithPassword` returns `invalid-credentials` for a wrong password
 * and for the attempt that trips the lockout, so without this field the two are
 * indistinguishable in the log exactly as they are in the response.
 */
export const AUTH_EVENT_OUTCOMES = ["success", "failure"] as const;

export type AuthEventOutcome = (typeof AUTH_EVENT_OUTCOMES)[number];

/**
 * The longest an address can be, per RFC 5321 §4.5.3.1. Truncating rather than
 * validating, for the reason `session.model.ts:15-24` gives: the value is
 * caller-supplied and refusing to record an over-long one would turn a cosmetic
 * overflow into a refused sign-in.
 */
export const AUTH_EVENT_MAX_EMAIL = 254;

/** See `truncate` in session.model. Exported so the setter is not re-invented. */
const truncate = (limit: number) => (value: string | null | undefined) =>
  typeof value === "string" ? value.slice(0, limit) : (value ?? null);

export interface AuthEvent {
  _id: Types.ObjectId;
  /**
   * Null only when the request named no account: `auth.login_failed` for an
   * unknown address, and `auth.password_reset_requested` for an unknown or
   * suspended one. Both are writes an operator needs, and the response is
   * deliberately identical either way, so the row is the only place the
   * difference is visible.
   */
  userId: Types.ObjectId | null;
  /**
   * Denormalised, so the row still reads after the user is deleted.
   *
   * Null on the two events whose request carries no address at all: `auth.logout`
   * presents a cookie and has no body, and `auth.password_reset_completed`
   * presents a token. Resolving an account on either path would mean a lookup
   * whose only purpose is a readable label on a row `userId` already identifies.
   */
  email: string | null;
  action: AuthEventAction;
  outcome: AuthEventOutcome;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

const authEventSchema = new Schema<AuthEvent>(
  {
    userId: { type: Schema.Types.ObjectId, default: null, ref: "User" },
    email: {
      type: String,
      default: null,
      // Truncation, not `maxlength`: see `AUTH_EVENT_MAX_EMAIL` above.
      set: truncate(AUTH_EVENT_MAX_EMAIL),
    },
    /**
     * The enum is a control, not documentation.
     *
     * `audit_logs` declares `action: { type: String, required: true }` with no
     * enum (`src/modules/audit/audit-log.model.ts:73`), so a caller typo becomes a
     * row nothing queries. This collection will not repeat that — and it matters
     * more here, because a write on this collection is *permitted to fail*: a
     * constraint that rejects a caller-supplied value turns a sign-in into a
     * 500. The vocabulary is closed anyway, so the enum costs nothing and
     * converts a typo into a rejected write rather than a query nobody finds.
     */
    action: {
      type: String,
      required: true,
      enum: AUTH_EVENT_ACTION_VALUES,
    },
    outcome: { type: String, required: true, enum: AUTH_EVENT_OUTCOMES },
    // Truncation in the setter, for the reason `session.model.ts:15-24` argues:
    // both are untrusted headers from a client we do not control, and refusing to
    // record an over-long one would refuse the sign-in it was going to describe.
    ip: { type: String, default: null, set: truncate(SESSION_MAX_IP) },
    userAgent: {
      type: String,
      default: null,
      set: truncate(SESSION_MAX_USER_AGENT),
    },
  },
  /**
   * There is no `Mixed` path here, and no `Object`-typed path of any kind. There
   * is no `changes` and no `metadata`. That absence is the single most important
   * property of this schema, because the caller-triggered rejection hazard
   * *requires* a field that accepts arbitrary content — a shape a caller puts in
   * can violate a server-side constraint, and on this collection a rejected write
   * is swallowed rather than thrown. `audit_logs` has two such fields
   * (`audit-log.model.ts:83,87`). With no unbounded field there is nothing left to
   * put a wrong shape into, so the hazard is unreachable by construction rather
   * than unlikely.
   */
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: "auth_events",
  },
);

/** "Your sign-in history": one account's events, newest first. */
authEventSchema.index({ userId: 1, createdAt: -1 });

/**
 * "What has been happening with this event type" — the detection queries behind
 * docs/SECURITY.md §12. Keyed on `action` rather than free text because the
 * vocabulary is closed: there are eight, so an `action` predicate is a fixed set
 * of index scans rather than an open-ended one.
 */
authEventSchema.index({ action: 1, createdAt: -1 });

/**
 * The retention TTL. **A named, deliberate exception to docs/DATABASE.md §1's
 * rule that every index names the query it serves** — this one names none,
 * because it exists to delete, and §8 says so rather than leaving the next
 * reader of that rule to trip over it.
 *
 * It is also the first TTL in the repository that deletes a *live* record. The
 * other four — `sessions`, `password_reset_tokens`,
 * `email_verification_tokens`, `invitations` — remove rows already dead by their
 * own `expiresAt`, which is the reasoning at `session.model.ts:81-82`: cleanup is
 * the database's job, so there is no cron and no cron to forget to run. These
 * rows are not dead when they expire. Deleting them is a decision about what to
 * stop being able to prove, which is why the period is a named constant here
 * rather than configuration, and why the account-owner read surface states the
 * window instead of presenting a truncated history as a complete one.
 */
authEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: AUTH_EVENT_TTL_DAYS * 24 * 60 * 60 },
);

export const AuthEventModel: Model<AuthEvent> =
  (mongoose.models.AuthEvent as Model<AuthEvent>) ??
  mongoose.model<AuthEvent>("AuthEvent", authEventSchema);

export const authEventSchemaDefinition = authEventSchema;
