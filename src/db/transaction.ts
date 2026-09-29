import type mongoose from "mongoose";
import { connectToDatabase } from "@/db/connection";

/**
 * Run a unit of work as a single MongoDB transaction.
 *
 * Multi-document writes need this: provisioning four roles is four inserts, and
 * three of them landing is worse than none, because a partial role set cannot
 * be repaired — the unique index refuses a second `OWNER`, so a retry of a
 * half-provisioned organisation fails on the very first insert and the tenant
 * is stuck. A transaction makes the set all-or-nothing.
 *
 * Requires a replica set. That is not a preference: MongoDB offers no
 * multi-document transactions on a standalone server, and the failure is an
 * opaque driver error rather than a clear one. Production runs on a managed
 * replica set, and the test harness already starts one for exactly this reason.
 */
export async function withTransaction<T>(
  work: (session: mongoose.ClientSession) => Promise<T>,
): Promise<T> {
  const db = await connectToDatabase();
  const session = await db.startSession();

  try {
    // withTransaction rather than startTransaction/commit: it retries the
    // callback on a transient error and on write conflict, which is exactly
    // the behaviour a multi-writer path wants, and it aborts on a genuine
    // failure instead of leaving a transaction open on the connection.
    //
    // The `await` has to be here, in the body, and the result returned on a
    // later line. `return session.withTransaction(...)` is the tidier-looking
    // spelling and it is wrong: in an async function a returned promise is
    // settled *after* the `finally` block runs, so `endSession()` would fire
    // while the transaction was still live and every write in it would fail
    // with "use of expired sessions is not permitted". The tidier version
    // fails at the last step, far from the cause.
    //
    // A sentinel rather than `undefined` so a callback that legitimately
    // returns undefined is not mistaken for one that never ran.
    const NOT_RUN = Symbol("transaction callback did not run");
    let result: T | typeof NOT_RUN = NOT_RUN;

    await session.withTransaction(async () => {
      result = await work(session);
    });

    if (result === NOT_RUN) {
      throw new Error("The transaction completed without running its work.");
    }
    return result;
  } finally {
    // Always end it. A session left open holds a server-side transaction slot,
    // and enough of those will block writes for the whole deployment.
    await session.endSession();
  }
}
