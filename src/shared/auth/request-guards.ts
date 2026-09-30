import { createAuthGuards } from "@/shared/auth/dal";
import { sessionTokenFrom } from "@/shared/auth/session-http";

/**
 * The authentication guards, bound to a specific request.
 *
 * The module-level `auth` in `dal.ts` reads the cookie from `next/headers`,
 * which only exists inside a Next.js request context. These routes read the
 * cookie from the `Request` they are given instead. That is what makes the
 * handlers testable with a real `Request` and a real cookie - the part of an
 * auth endpoint most likely to be subtly wrong - and it works in Next too,
 * because a route handler's `Request` carries the cookie header.
 *
 * The guards themselves are the shared, tested core from the DAL; this only
 * changes where the token comes from, not how the token is checked.
 */
export function guardsFor(request: Request) {
  // `sessionTokenFrom` is sync; the guard contract is async.
  return createAuthGuards(async () => sessionTokenFrom(request));
}
