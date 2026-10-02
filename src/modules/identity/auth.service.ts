import type { Types } from "mongoose";
import { burnPasswordTiming } from "@/modules/identity/password";
import {
  authenticateWithPassword,
  createPasswordResetToken,
} from "@/modules/identity/password.service";
import { type User, UserModel } from "@/modules/identity/user.model";
import { AppError } from "@/shared/errors/app-error";

/**
 * Sign-in and password reset, as business rules.
 *
 * The routes around these decide what the response *looks* like; the rules here
 * decide what actually happened. The split matters most for enumeration: these
 * functions are the only place that knows whether an address is registered, and
 * every one of them reports it in a way the route cannot accidentally leak.
 *
 * Imports are by module, never through `@/modules/identity`. This file is
 * exported by that barrel, so a barrel import here is a cycle: it resolves,
 * because the barrel happens to declare this module's exports before the
 * handlers run, and it keeps resolving until someone moves an export. What
 * breaks is not this import but the next one added underneath it, in a stack
 * trace that points at neither.
 */

/**
 * A successful sign-in. `ok: true` is present so the union with `LoginRefusal`
 * discriminates on one field; without it the route's `if (!outcome.ok)` would be
 * a test for a property the success shape does not have.
 */
export interface LoginResult {
  ok: true;
  user: User;
}

/**
 * A refused sign-in, described without being reported.
 *
 * The three reasons are what `withApi` logs and what the audit event records; none
 * of them reaches the client. `userId` is null exactly when the address was not
 * registered — the one case where there is no account to attribute the attempt
 * to, and the case an operator most wants to see, since an unauthenticated
 * caller naming addresses is what credential stuffing looks like before it
 * becomes a takeover.
 *
 * `locked` is carried rather than folded into `reason`, because the attempt that
 * trips the lockout is *also* a wrong password, and a union of reasons would have
 * to drop one of those two facts. `authenticateWithPassword` decides it (see
 * `password.service.ts`); this only passes it up.
 */
export type LoginRefusal = {
  ok: false;
  userId: Types.ObjectId | null;
  reason:
    | "unknown-account"
    | "invalid-credentials"
    | "locked-out"
    | "suspended";
  locked: boolean;
};

/**
 * Verify a password and report success.
 *
 * Every failure - unknown address, wrong password, locked out, suspended -
 * is rendered as one identical `UNAUTHENTICATED`. Not because the reasons are
 * unimportant but because they are exactly what an attacker is guessing at: a
 * distinct code or message for "no such account" turns the endpoint into a
 * membership oracle, and a distinct one for "locked out" confirms a correct
 * password to someone who only had the address. The caller learns the difference
 * from the log and the audit event, not the body.
 *
 * **This returns rather than throwing on refusal**, and the route raises the
 * error. That is a deliberate change of shape from the rest of this file, and the
 * reason is that the reasons are no longer only for the log: ADR-0006 writes an
 * `auth.login_failed` row and, on the attempt that trips it, an `auth.lockout`
 * row, and neither the account nor the lockout flag is reachable from an
 * exception's message. Putting the throw in the route keeps the enumeration
 * defence exactly where it was — the response is still one code, one message,
 * one `internal` — while giving the caller the facts it needs. The alternative
 * was parsing `AppError.internal` back out of a message, which makes a security
 * record depend on a human-readable string surviving an edit.
 *
 * The `burnPasswordTiming` call is the other half. Without it an unregistered
 * address returns in the time it takes to miss the index, while a registered one
 * takes a bcrypt verification, and the difference is measurable over a network
 * from outside.
 *
 * The dummy hash is a genuine cost-12 hash rather than a cheap stand-in, which
 * is what makes this worth doing — but "the same" has to be read carefully. This
 * is `bcryptjs`, a JavaScript implementation, so one hash is not a fixed quantum
 * of time: it varies with the machine, and it runs on the same event loop as the
 * request that is timing it. What the burn equalises is the one large term. A
 * residual difference remains, from the index lookup, the document fetch and the
 * failure-counter write, and it is small and constant rather than the
 * order-of-magnitude signal that unburned bcrypt gives away. Stating it as
 * "genuinely the same" would be claiming a property nobody measured, and a
 * reviewer who measured it and found otherwise would be right.
 *
 * The locked-out and suspended refusals burn too, inside
 * `authenticateWithPassword`. They are the two outcomes an attacker cannot
 * otherwise distinguish from a wrong password, and they are also the two that
 * return without any bcrypt work at all.
 */
export async function loginWithPassword(
  email: string,
  password: string,
  now = new Date(),
): Promise<LoginResult | LoginRefusal> {
  const user = await UserModel.findOne({
    email: email.trim().toLowerCase(),
  }).select("+passwordHash");

  if (!user) {
    await burnPasswordTiming(password);
    return {
      ok: false,
      userId: null,
      reason: "unknown-account",
      locked: false,
    };
  }

  const outcome = await authenticateWithPassword(user, password, now);
  if (!outcome.ok) {
    return {
      ok: false,
      userId: user._id,
      reason: outcome.reason,
      locked: outcome.locked,
    };
  }

  return { ok: true, user: outcome.user };
}

/**
 * The one error a refused sign-in ever becomes.
 *
 * Exported so the route throws the identical error this function used to throw
 * itself — the codes and messages must not be able to drift apart, which is the
 * entire property `auth.login_failed` is recorded next to.
 */
export function unauthenticated(reason?: string): AppError {
  return new AppError("UNAUTHENTICATED", {
    message: "Sign in to continue.",
    // The reason is for the log, never the body: `internal` is not serialised
    // into the error payload, while `message` is.
    internal: reason
      ? `login failed: ${reason}`
      : "login failed: unknown account",
  });
}

/**
 * Begin a password reset.
 *
 * Returns a token only for an address that belongs to an account. The route
 * answers `200` either way and does not read this value unless it is sending
 * mail, so the difference cannot reach the client - the enumeration defence does
 * not depend on the route remembering to discard it, because the route has no
 * way to ask.
 *
 * Suspended accounts are excluded: a reset link would otherwise hand a
 * deliberately disabled account a fresh way back in.
 */
export async function startPasswordReset(
  email: string,
  requestIp?: string | null,
): Promise<{ token: string | null; userId: Types.ObjectId | null }> {
  const user = await UserModel.findOne({
    email: email.trim().toLowerCase(),
    status: "ACTIVE",
  });

  if (!user) return { token: null, userId: null };

  const { token } = await createPasswordResetToken(user._id, requestIp ?? null);
  return { token, userId: user._id };
}
