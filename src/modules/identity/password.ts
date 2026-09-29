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

/** Cost 12, per docs/DATABASE.md §2. ~250ms per hash on current hardware. */
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
