import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * Password hashing and the token primitives shared by sessions, password
 * resets and email verification.
 *
 * The two hashes here are deliberately different algorithms, and the
 * difference is the point:
 *
 * - Passwords are slow to verify (bcrypt) and are *guessed*, so the cost is
 *   what makes an offline attack expensive.
 * - Session and reset tokens are 256-bit random, not guessed, so they are
 *   hashed fast (SHA-256). bcrypt here would add a per-request cost to every
 *   authenticated request and buy nothing, because there is no dictionary to
 *   search.
 *
 * Both are one-way, so a database dump yields no usable credential either way.
 */

/** Cost 12, per docs/DATABASE.md §2. ~1.8s/hash on i5-7200U; ~250ms on modern server CPU (Vercel). */
export const BCRYPT_COST = 12;

/** 32 bytes of entropy, per docs/SECURITY.md §4. */
export const TOKEN_BYTES = 32;

const BCRYPT_HASH = /^\$2[aby]?\$(\d{2})\$/;

/**
 * Hash a password for storage.
 *
 * The returned value carries its own cost in the string, so raising
 * BCRYPT_COST later does not invalidate existing hashes: `verifyPassword`
 * reads the cost from the hash it is given and rehashes on next login.
 */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Whether a password matches a stored hash.
 *
 * Never throws. A malformed or truncated hash in the database is treated as a
 * failed comparison rather than a 500: the correct response to an unreadable
 * credential is to refuse access, and letting an exception escape would turn a
 * data problem into an error that distinguishes "wrong password" from "this
 * account is broken".
 */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * A real cost-12 hash of a value nobody knows, used to spend the same time
 * verifying a password for an address that is not registered as for one that is.
 *
 * It has to be a genuine cost-12 hash of the *current* cost factor, not a cheap
 * stand-in: the whole point is to be indistinguishable from a real verification,
 * and a faster dummy reinstates the timing difference it exists to hide. It is
 * generated, never hand-written, so the cost in the string cannot drift out of
 * step with `BCRYPT_COST`.
 *
 * Computed on first use and then kept. `bcrypt.hashSync` at module scope was the
 * obvious version and it cost a full cost-12 hash on *import* — about 1.8s of
 * blocked CPU before anything could run, in the test runner, in `next build`, and
 * in every serverless cold start, paid on every process whether or not anyone
 * ever tried to sign in. The cost is a per-process constant, so there is nothing
 * to synchronise, and a module-level promise is enough to make the second caller
 * wait rather than start a second hash.
 */
let dummyHash: Promise<string> | undefined;

export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= bcrypt.hash(
    "not-a-real-password-used-only-for-timing",
    BCRYPT_COST,
  );
  return dummyHash;
}

/**
 * The resolved dummy hash, for the rare caller that needs the value itself.
 *
 * Exports a promise rather than a string because the alternative is a top-level
 * `await`, which this module cannot do: `password.service` imports this one, and
 * a top-level await here would make the pair mutually dependent in a way that
 * fails at import time rather than at call time.
 */
export const DUMMY_PASSWORD_HASH: Promise<string> = getDummyPasswordHash();

/**
 * Spend a verification's worth of time and discard the result.
 *
 * Called on the sign-in path when the address is unknown, when the account is
 * suspended, and when the account is locked out, so that every refused sign-in
 * takes the same time and the response time stops answering "is this address
 * registered?" or "is this account locked?".
 */
export async function burnPasswordTiming(plain: string): Promise<void> {
  await verifyPassword(plain, await getDummyPasswordHash());
}

/** Whether a stored hash was made at a lower cost than we use now. */
export function needsRehash(hash: string): boolean {
  const match = BCRYPT_HASH.exec(hash);
  return match ? Number(match[1]) < BCRYPT_COST : true;
}

/**
 * A fresh opaque token, for a session cookie or an emailed reset link.
 *
 * base64url, so it survives a cookie value, a URL path and a JSON body without
 * escaping. `crypto.randomBytes` is a CSPRNG; this must never become
 * `Math.random`.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** The value stored in the database for a token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Compare a token against a stored hash in constant time.
 *
 * Not strictly needed for the session path, which looks up by hash and so never
 * compares secrets. It matters where a supplied value is compared against a
 * stored one directly - the "does this reset link match" check - where an
 * early-exit string comparison would leak the prefix length through timing.
 */
export function tokensMatch(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");

  // timingSafeEqual throws on a length mismatch, and the length of a hash is
  // not a secret worth protecting, so the length check comes first.
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
