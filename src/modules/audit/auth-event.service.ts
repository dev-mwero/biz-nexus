import type { Types } from "mongoose";
import {
  type AuthEvent,
  type AuthEventAction,
  AuthEventModel,
  type AuthEventOutcome,
} from "@/modules/audit/auth-event.model";
import { redact } from "@/shared/lib/redact";

/**
 * The authentication event writer.
 *
 * The opposite of `recordAction` in exactly one respect, and that is the whole
 * point of it: `recordAction` throws so a caller cannot silently skip an audit
 * row, and this returns `null` so a caller cannot fail over one. The asymmetry is
 * argued in ADR-0006 — the polarity inversion with `recordFailedLogin`'s `$inc` —
 * and it is the reason this is a separate collection rather than another field
 * on `audit_logs`.
 *
 * Two consequences are worth stating at the call site rather than here, because
 * they are properties of what this function declines to do:
 *
 * - **Never call it inside a transaction.** It takes no session, and there is no
 *   session argument to pass. Enlisting the insert would roll the primary work
 *   back when the event write is rejected, which is the failure mode the policy
 *   exists to prevent. The cost of not enlisting it is a row that survives a
 *   sibling write being rolled back — an event that really did happen, recorded
 *   for a transaction that did not.
 * - **Never await it before the response if the request can fail without it.**
 *   It is awaited, because a fire-and-forget write is a write whose failure the
 *   process may never observe, and the single log line below is the only record
 *   that an event was lost. That line is emitted synchronously before the `null`
 *   comes back.
 */

export interface RecordAuthEventInput {
  action: AuthEventAction;
  outcome: AuthEventOutcome;
  /**
   * Null only when the request named no account — see `AuthEvent.email`. Not
   * defaulted, because "the caller forgot" and "there was no account" are
   * different facts and a `null` here reads as the second one.
   */
  userId?: Types.ObjectId | null;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /**
   * Required, and threaded explicitly from the route handler's `ApiContext`
   * rather than read from ambient state.
   *
   * The whole loss-visibility argument in ADR-0006 rests on an operator being
   * able to take a request id a user has quoted and determine *definitively*
   * whether that request's event was recorded. Ambient state would make that a
   * property of whether someone remembered to install a context provider,
   * rather than of the type signature. Making it required is what keeps every one
   * of the six handlers honest: a new call site cannot compile without answering.
   */
  requestId: string;
  /** Defaulted to now. Only an event replayed from a payload carries one. */
  occurredAt?: Date;
}

/**
 * Report a dropped event. Exactly one line, exactly one level.
 *
 * `console.error` directly rather than the shared `consoleLogger`: importing
 * `@/shared/api/with-api` from a module would pull the route wrapper — and
 * `next/navigation` with it — into the data layer, which inverts the dependency
 * this repository otherwise keeps one-way. The line shape is identical either
 * way, because `consoleLogger` is itself `console.error(JSON.stringify(redact(
 * entry)))` (`src/shared/api/with-api.ts:57-61`) and the redactor is imported
 * from its own module rather than from the wrapper for the same reason.
 *
 * `redact` is a no-op on this entry — none of these keys is in `SENSITIVE_KEYS`
 * (`src/shared/lib/redact.ts:17-40`) — and it is here anyway, on the reasoning
 * at `src/shared/events/bus.ts:56-61`: the one line nobody is watching is not
 * the place to decide the entry is safe to assemble by hand.
 */
function reportDroppedEvent(input: RecordAuthEventInput, cause: unknown): void {
  const entry: Record<string, unknown> = {
    // Fixed and greppable. Detection is a match against this literal, not a
    // semantic search over prose the next edit to a message would break.
    event: "auth_event_write_failed",
    action: input.action,
    // The same id as the request's own line in withApi, which is what makes the
    // loss answerable per request rather than "somewhere in the last hour".
    requestId: input.requestId,
    userId: input.userId ? input.userId.toString() : null,
    message: cause instanceof Error ? cause.message : String(cause),
  };
  console.error(JSON.stringify(redact(entry)));
}

/**
 * Write one row. Returns the row, or `null` if the write failed — and never
 * throws, for any reason, including a caller-supplied value that violates a
 * constraint.
 *
 * The catch is deliberately wide and deliberately not narrowed by `AppError`:
 * this is the boundary where every failure becomes a log line, and a filter here
 * would be a control that can be switched off per call site — the argument
 * ADR-0006 makes about the `Origin` check and about the absence of a per-event
 * write-failure policy.
 */
export async function recordAuthEvent(
  input: RecordAuthEventInput,
): Promise<AuthEvent | null> {
  try {
    // The array form, so the return type is a list whatever Mongoose does with a
    // single-document `create`. Validation runs before the insert either way,
    // which is what makes a bad enum value a rejected write rather than a row.
    const [created] = await AuthEventModel.create([
      {
        userId: input.userId ?? null,
        email: input.email ?? null,
        action: input.action,
        outcome: input.outcome,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        // `occurredAt` in, `createdAt` stored — the same mapping `recordAction`
        // does at `audit.service.ts:237`, and the same reason: the payload's
        // timestamp is authoritative when there is one, and a caller cannot set
        // it by writing `createdAt`.
        ...(input.occurredAt ? { createdAt: input.occurredAt } : {}),
      },
    ]);
    return created ?? null;
  } catch (cause) {
    reportDroppedEvent(input, cause);
    return null;
  }
}
