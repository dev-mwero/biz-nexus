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

export interface LoginResult {
  user: User;
}

/**
 * Verify a password and report success.
 *
 * Every failure - unknown address, wrong password, locked out, suspended -
 * throws the same `UNAUTHENTICATED`. Not because the reasons are unimportant but
 * because they are exactly what an attacker is guessing at: a distinct code or
 * message for "no such account" turns the endpoint into a membership oracle, and
 * a distinct one for "locked out" confirms a correct password to someone who only
 * had the address. The caller learns the difference from the log, not the body.
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
): Promise<LoginResult> {
  const user = await UserModel.findOne({
    email: email.trim().toLowerCase(),
  }).select("+passwordHash");

  if (!user) {
    await burnPasswordTiming(password);
    throw unauthenticated();
  }

  const outcome = await authenticateWithPassword(user, password, now);
  if (!outcome.ok) {
    // `reason` distinguishes "invalid-credentials" from "locked-out" from
    // "suspended" for the caller, and is deliberately dropped here.
    throw unauthenticated(outcome.reason);
  }

  return { user: outcome.user };
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

function unauthenticated(reason?: string): AppError {
  return new AppError("UNAUTHENTICATED", {
    message: "Sign in to continue.",
    // The reason is for the log, never the body: `internal` is not serialised
    // into the error payload, while `message` is.
    internal: reason
      ? `login failed: ${reason}`
      : "login failed: unknown account",
  });
}
