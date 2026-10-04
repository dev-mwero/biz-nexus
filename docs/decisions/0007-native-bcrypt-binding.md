# ADR-0007 — Password hashing should use the native bcrypt binding

- **Status:** accepted — the recommendation is adopted; the swap is gated on the
  install-script condition below, and the runtime still hashes with `bcryptjs`
- **Date:** 2026-10-04 (resolved 2026-10-05)
- **Affects:** `src/modules/identity/password.ts`, `docs/SECURITY.md` §2, `docs/DATABASE.md` §2, the auth rate limiter, the test fixtures that hash a password

## Context

Task 1.78 asked for an evaluation of a native bcrypt binding against `bcryptjs`,
with the cost factor held at 12 on both sides. The cost factor is not part of that
evaluation: `docs/SECURITY.md` §2 and `docs/DATABASE.md` §2 pin bcrypt at cost 12
because that number is what makes an offline attack expensive, and it is revisited
by a decision to change the security posture, not by a decision to make hashing
faster.

The evaluation had a specific doubt to settle. The documentation said bcrypt cost
12 took "~1.8s/hash on i5-7200U; ~250ms on modern server CPU", and
`docs/PLAN.md` read the two halves of that sentence as a >7x discrepancy with a
security consequence: task 1.31 sizes a rate limiter, and a limiter sized against
250ms on a machine that spends 1.8s hashing does not bound the attack it exists to
bound.

`scripts/bench-bcrypt.mjs` existed but had never been run against a native
binding — `bcrypt` was not a dependency — so the comparison had no second column.
The other suspect was never examined at all: `bcryptjs` was still described as
taking 1.8s, a figure carried from `bcryptjs` 2.x. The installed version is 3.0.3,
and the 2.x-to-3.x gap on identical hardware at identical cost is larger than the
gap the ADR was written to measure.

## Measurement

`npm run bench:bcrypt`, on the machine named in the documentation — an i5-7200U,
four cores, Node 24.15.0, cost 12 on both sides, median of 12 iterations.
Reproducible with `node scripts/bench-bcrypt.mjs 12`.

| | `bcryptjs` 3.0.3 | `bcrypt` 6.0.0 (prebuilt, linux-x64) |
|---|---|---|
| hash, idle | 616 ms | 334 ms |
| verify, idle | 621 ms | 358 ms |
| hash, four concurrent | 2255 ms | 442 ms |

Both rows matter and the second is the one that decided it.

**The documented 1.8s was never a property of the hardware.** It was a property of
contention. `bcryptjs` is single-threaded JavaScript that yields between rounds,
so N hashes on N cores still each take about N times as long as one; a fixture
hash in each of Vitest's four workers observes ~2.2s, which is where the figure in
`vitest.config.mts` and `tests/support/auth-contract.ts` came from and why it was
never wrong as an observation. Measured idle, the same hash is 616ms. The
documentation attributed to an i5 a number that was really about a test runner.

**The native binding does not have that shape.** Its promise-based API dispatches
onto the libuv threadpool, so four concurrent hashes cost 442ms each rather than
4 × 334ms. Under the conditions the test suite actually runs in, it is 5.1x faster;
on an idle machine, 1.8x.

**The ~250ms figure is sound, for the implementation it was always describing.**
A native cost-12 bcrypt measures 334ms on a four-year-old laptop core and 250ms on
a current server CPU. The documentation's second half was right about native
bcrypt and wrong about what the product used.

## Recommendation

Accepted: `hashPassword` and `verifyPassword` should move to the native `bcrypt`
binding. The cost factor stays at 12 and the algorithm stays bcrypt.

The argument is not the 1.8x on an idle machine; a sign-in that takes 334ms rather
than 616ms is not a security property. It is what the number does to everything
sized against it. Task 1.31's rate limiter, `getDummyPasswordHash`'s equalisation
hash on every refused login path, and the cost of a fixture in every test that
touches authentication are all calibrated on "what does one bcrypt cost here", and
all three are wrong by a factor that varies with load rather than being a constant
they can be pinned to. A cost that is stable under concurrency is worth more than a
smaller one that is not.

## The gate

The swap makes `bcrypt` a runtime dependency of the auth path, and `bcrypt` ships
its work through an install script (`node-gyp-build`). That is the only thing
standing between the recommendation and the code, so it is stated as a condition
that can be checked rather than as an open question.

**Verified on 2026-10-05.** `bcrypt@6.0.0` bundles seven prebuilds — `darwin-arm64`,
`darwin-x64`, `linux-arm`, `linux-arm64`, `linux-x64`, `win32-arm64`, `win32-x64`
— and `require("bcrypt")` resolves and hashes successfully with the install script
never having run. `node-gyp-build` is a *fallback* that compiles from source only
when no prebuild matches. So a target with a bundled prebuild needs no compiler and
no script, and every platform this project plausibly deploys to has one.

`package.json` sets `allowScripts` to `{"mongodb-memory-server@11.3.0": true}`, so
npm skips `bcrypt`'s script. That is correct and it is not the blocker: the
prebuilds mean it does not need to run.

**The condition on making the swap:** every deployment target resolves to one of the
seven prebuilds above. Verified for this repository's own install and for Vercel,
whose builders are `linux-x64`. If a target is ever added that is not on that list,
the swap needs `allowScripts` to include `bcrypt`, or it needs to be reverted to
`bcryptjs` — otherwise the module throws on first import in production, which is a
worse failure than a build failure and is why it is written down rather than
discovered.

**Why the code still says `bcryptjs`.** The gate is checkable but has not been
checked against every environment this might ever be deployed to, and the swap
touches the sign-in path for everyone. An auth change of that kind wants its own
commit with the suite run against it, not to be folded into whatever else happens
to be open when the decision is recorded. `src/modules/identity/password.ts`
therefore still uses `bcryptjs`, and every figure quoted in `docs/SECURITY.md` §2 is
measured on `bcryptjs` — which remains true, and remains worth saying.

Two further notes for whoever makes the swap:

- **argon2 was not evaluated and is probably the better primitive.** It is what a
  new system should reach for, but adopting it changes the cost parameter's
  meaning, and 1.78 was scoped to the implementation with the cost held constant.
  Recorded here as the next decision rather than smuggled in with this one.
- **Hash compatibility is not a migration concern.** Both libraries emit and accept
  `$2b$12$...`, so a hash written by either verifies under the other and every
  stored credential would survive the change.

## Consequences

- `docs/SECURITY.md` §2 and `docs/DATABASE.md` §2 quote measured numbers and name
  the measurement, instead of a figure for a different library on a different
  machine under a different load.
- The "~2.1s per hash" comments in `vitest.config.mts` and
  `tests/support/auth-contract.ts` are reattributed: they describe a fixture hash
  inside a four-worker suite, not the cost of hashing.
- `scripts/bench-bcrypt.mjs` reports the library versions and prints serial and
  concurrent figures, because a timing without either is not reproducible — the
  2.x-to-3.x gap in `bcryptjs` is larger than the effect being measured here.
- `bcrypt` is a devDependency: the benchmark needs it, and nothing in the running
  application does until the swap above is made.