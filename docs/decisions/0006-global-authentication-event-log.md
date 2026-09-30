# ADR-0006 — Authentication events go to their own global, tenant-free collection

- **Status:** accepted
- **Date:** 2026-09-30
- **Affects:** the identity module, `src/modules/audit`, the Data Access Layer, every route handler under `src/app/api/v1/auth`

## Context

`docs/SECURITY.md` §2 lists Audit as a defence-in-depth layer, and §3 applies the
request checklist to every route handler and every Server Action "without
exception". Step 8 of that checklist is "Record the audit entry and emit the
event".

`src/modules/audit` exists. `AUDIT_ACTIONS` is defined. `recordAction` is
written, tested, and enforces redaction and an append-only shape. And
`grep recordAction` across `src/app/api` and `src/modules/identity` returns
nothing at all.

So the eight highest-value security events in the system are unaudited: sign-in,
failed sign-in, account lockout, sign-out, sign-out-everywhere, registration,
password reset requested, and password reset completed. These are not the events
an organisation administrator is curious about. They are the events an
investigator needs when somebody asks whether an account was taken over, and they
are the events whose absence is why an account takeover is hard to prove after the
fact.

This is structural rather than an oversight, and that is the finding.

`RecordActionInput.organizationId` is required, and it is required because the
log is tenant-scoped by design. ADR-0003 makes `organizationId` mandatory on
every tenant collection; `docs/SECURITY.md` §6 Layer 2 records it as a
documented invariant; `tests/unit/architecture/audit-log.test.ts` enforces the
append-only property over that collection. The scoping is not incidental — it is
the mechanism by which a cross-tenant read is impossible rather than unlikely.

Authentication is inherently **pre-tenant**. A new user has
`activeOrganizationId: null` by design, and register, login, forgot-password,
verify-email and reset-password all happen before any organisation exists. Some
happen before the account exists. For those five, there is no tenant to scope the
row to, and the log as designed structurally cannot record the one phase of the
lifecycle where account takeover happens.

The two properties are not merely inconvenient together. One of them is the
product's primary security invariant.

## Options considered

**A. Make `organizationId` nullable on `audit_logs`.** Rejected, and not
closely. ADR-0003 and `docs/SECURITY.md` §6 Layer 2 make "every tenant
collection requires `organizationId`" a documented invariant, and
`tests/unit/architecture/audit-log.test.ts` already enforces properties over the
collection that a nullable scope would quietly complicate. Weakening a tenant
invariant to accommodate the pre-tenant phase is a far worse trade than a second
collection: the pre-tenant phase is 5 of 9 endpoints, and the invariant covers
every other collection in the product, for the whole of the product's life. A
nullable `organizationId` also makes every future read a question — "is this
row mine, or is this row everyone's?" — where today the answer is structural.

**B. Write the auth events somewhere else entirely — a log drain, an analytics
pipeline, CloudWatch.** Rejected: it makes the audit trail a second-class
artefact that is not queryable by the same means, not covered by the same
append-only test, and not readable by the same code that reads everything else.
An audit trail that lives somewhere an operator has to log into separately is
not one anybody reads during an incident.

**C. Reuse `audit_logs` with a sentinel organisation.** Rejected: a sentinel id
is a lie in a security record. A reader filtering by tenant sees a real-looking
row, and a row that is not what it claims to be is worse than a row that is
obviously in a different collection.

**D. A second collection, global, with no `organizationId`.** **Chosen.**

## Decision

`auth_events`: append-only, global, and carrying no organisation reference of
any kind. Not a nullable field — no field. The absence is the mechanism, in the
same way and for the same reason that `TenantRepository` makes an unscoped query
unexpressible (ADR-0003). A row that cannot name a tenant cannot be filtered by
one, mis-scoped, or joined to a tenant the reader does not belong to.

The shape mirrors `audit_logs` where the meaning is the same and diverges where
the meaning is not:

| Field | `audit_logs` | `auth_events` | Why |
|---|---|---|---|
| `organizationId` | required | **absent** | the decision above |
| `actorId`, `actorName` | present | `userId`, `email` | an auth event is *about* a user, and the row must still read after the user is deleted |
| `action` | `deal.stage_change` | `auth.login`, `auth.login_failed`, `auth.lockout`, `auth.logout`, `auth.logout_all`, `auth.register`, `auth.password_reset_requested`, `auth.password_reset_completed` | a closed vocabulary, not free text — an audit action nobody can enumerate is not queryable |
| `changes` | before/after diff | **absent** | there is no prior state of a sign-in to diff against |
| `metadata` | `Mixed` | **absent** | nothing on a sign-in needs a free-form field, and a `Mixed` field is a caller-triggered rejection waiting to happen — see the schema constraints below |
| `outcome` | implied by whether the row exists | `success` \| `failure`, always present | a *failed* sign-in is the event people need and cannot be inferred from an absent row |
| `ip`, `userAgent` | present | present, same truncation | same untrusted-header handling as `sessions.ip` |
| `createdAt` | present | present | |

**Append-only, enforced the same way.** No `updatedAt`, no soft-delete field, no
`Repository` export in the barrel — the three properties
`tests/unit/architecture/audit-log.test.ts` asserts over `audit_logs`, asserted
again over `auth_events` by a mirrored architecture test. Nothing in the type
system can express the absence of a method, so the rule is checked by reading
the source, and it has to be checked twice or the second collection becomes the
one with an update path.

**The write-failure policy: fail open on the record, fail closed on the
control.** An event write that fails is dropped, the request succeeds, and the
loss is reported. That is the whole policy, and it is argued here as a security
decision rather than an availability one — which is not where an ADR would
usually reach for, and the reason is worth being explicit about.

The argument is polarity. `authenticateWithPassword` calls `recordFailedLogin`
(`src/modules/identity/password.service.ts:83`), and `recordFailedLogin`
performs the `$inc` that counts toward `MAX_FAILED_LOGINS`
(`src/modules/identity/password.service.ts:121-125`). Had the event write been
placed ahead of that mutation and the policy been "block", then an adversary able
to make `auth_events` reject writes would have stopped the counter from ever
being incremented. Account lockout — the primary brute-force control — not
degraded, off. A sign-in that succeeds and then 500s is a symptom; a disabled
lockout is a security-control bypass, and no number of the first is preferable to
one missing row.

The ordering is what makes this moot in practice rather than merely argued:
`recordFailedLogin` runs before any event write would exist, and under a
non-throwing write the mutation always runs regardless. The policy is stated in
polarity terms anyway, because polarity is what survives the next person who
proposes reordering.

The availability objection is eliminated rather than answered. An `auth_events`
insert measures 3.54ms at best and 9.74ms at the median. Every login path —
success, wrong password, locked, suspended, unknown address — already spends a
full cost-12 bcrypt, because every refusal path calls `burnPasswordTiming`
(`src/modules/identity/password.service.ts:74,78`,
`src/modules/identity/auth.service.ts:71`), measured at 2157ms at best. The
insert is under half a percent of a login either way. That is not *why* the
policy is to drop the event; it is why nothing was given up by making it so. A
reader who meets the number first should not come away believing the policy
rests on it.

A write that throws fails the request, so a successful sign-in that 500s on its
own log is a regression, and it is asserted to be impossible in
`tests/integration/auth/auth-event-write-failure.test.ts`.

**The failure path is a log line, and never a collection row.** A dropped event
is reported through the application logger and by nothing else. Writing a row to
record that a row could not be written fails for exactly the reason the first
write failed, so an implementation reading this clause as licensing a second
collection write has inverted it. Asserted by
`tests/integration/auth/auth-event-write-failure.test.ts`.

**Uniform across all eight events; there is no opt-out list.** Every event
follows the policy above, including the two an attacker drives — and that is the
opposite of the intuition worth correcting. `auth.login_failed` and
`auth.lockout` are written on precisely the paths that run through
`recordFailedLogin`, which is where the polarity inversion bites hardest, so
these two argue for dropping *more* strongly than the rest rather than for
stricter treatment. A per-event policy would hand the two events that matter most
the opposite of the correct rule. The secondary reason is volume: the
attacker-driven events are the high-volume ones, and a policy keyed on volume
silently changes meaning as the product grows. It is the same argument as the
absence of an opt-out on the `Origin` check — a control that can be switched off
per call site is not a control. Asserted for all eight by
`tests/integration/auth/auth-event-log.test.ts`, which has no per-event branch to
skip.

**The event write is never enlisted in the caller's transaction.** The insert
runs outside any session the surrounding handler opened. Enlisting it would make
a rejected event write roll back the primary work and fail the request, which is
precisely the outcome this policy exists to prevent. The cost is chosen knowingly:
inside a transaction the same insert measures 8–11ms at the median against
3–6.7ms standalone, and that latency is paid in exchange for the request never
failing because of the log.

The event bus is not an escape hatch here. `emit` is a `for … await` loop over
the subscriber list (`src/shared/events/bus.ts:139-145`), so it isolates
*failures* and nothing else: a wired audit subscriber is on the critical path by
construction, and N subscribers cost the sum of their latencies rather than the
maximum. The bus is not available in any case — it has one subscriber
(`src/modules/activities/activity.subscriber.ts:42`) and no emitter, since
`events.emit` appears nowhere in `src/`.

Asserted in `tests/integration/auth/auth-event-log.test.ts`: the event survives
a rolled-back sibling write, which is the observation that would fail if the
insert were enlisted in the session.

**Loss visibility: three parts, and detection is manual.** A dropped event is
invisible by construction, and a loss nobody is looking for is indistinguishable
from an event that never happened. Three things close as much of that as this
architecture allows.

1. **A fixed, greppable token.** One line at error level carrying the stable
   literal `event: "auth_event_write_failed"` alongside `action`, `requestId`,
   `userId` and the error message. The literal is the whole point: detection is a
   match against a known string, not a semantic search over prose that the next
   edit to a message would silently break. None of those keys is in
   `SENSITIVE_KEYS` (`src/shared/lib/redact.ts:17-40`), so the redactor passes
   the line through intact. It is never emitted at `info`, and never swallowed by
   a `catch` that downgrades it. On this path it is arguably the most important
   line the system emits, because it is the only record that an event was lost.
2. **Correlation by `requestId`.** This is what actually closes the
   false-assurance gap, and it costs no infrastructure. `requestId` is generated
   in `withApi`, appears on every log line, and is returned to the client in
   `x-request-id` (`src/shared/api/with-api.ts:62,288,341`). An operator holding
   a request id a user has quoted can therefore determine *definitively* whether
   that request's event was recorded, which converts "absence is ambiguous" into a
   per-request answer. The failure line must carry the same `requestId` as the
   request's own line.
3. **A written runbook query**, recorded in `docs/SECURITY.md` §12 and run on
   demand. It is manual: this repository has no scheduler, no cron and no
   long-lived workers (`docs/ARCHITECTURE.md:65`), and standing up any of them to
   watch one log line would cost more than the loss it prevents.

Detection is manual. Nothing pages anyone, and the presence of a query must not
be read as automation — that implication is itself the false assurance being
guarded against.

Parts 1 and 2 are asserted by
`tests/integration/auth/auth-event-write-failure.test.ts`: a failing write emits
exactly one error line carrying the literal and the request's own `requestId`,
and the response still succeeds. Part 3 is a document, so it has nothing to
assert, which is the honest shape of a manual control.

Rejected explicitly: an `x-audit-degraded`-style response header. It is a status
oracle on the hottest path in the product, visible to the attacker and to the
operator alike, and it buys neither of them anything they can act on differently.

**Schema constraints that make a caller-triggered rejection unreachable.** The
residual hazard this policy does not cover is a caller-supplied value violating
a server-side constraint and turning a refusal into a 500. The goal is not that
it is unlikely. The goal is that there is no shape a caller can violate. Four
controls, every one of them free at runtime.

1. **`action` carries a server-side `enum`.** `audit_logs` declares
   `action: { type: String, required: true }` with no enum
   (`src/modules/audit/audit-log.model.ts:73`); `auth_events` will not repeat
   that. The vocabulary is closed above anyway, so the constraint costs nothing
   and converts a typo into a rejected write rather than a query nobody finds.
2. **No `Mixed` field on `auth_events` at all** — no `changes`, no `metadata`.
   This is the single most important control, because the caller-triggered lever
   *requires* a field that accepts arbitrary content, and `audit_logs` has two
   (`src/modules/audit/audit-log.model.ts:83,87`). With no `Mixed` and no
   `Object`-typed path, there is nothing left for a caller to put a wrong shape
   into.
3. **Truncation in the schema setter, not at the call site.** `ip` and
   `userAgent` truncate through `set:`
   (`src/modules/identity/session.model.ts:65-70`), the same pattern both token
   models use (`password-reset-token.model.ts:49`,
   `email-verification-token.model.ts:46`), and `session.model.ts:15-24` already
   argues why truncation beats `maxlength`: rejecting an over-long user agent
   would refuse a sign-in over an untrusted header. Reuse it, and bound `email`
   the same way, so an over-long value cannot reach the server whatever the
   caller passed.
4. **An architecture test asserting the absence**, in the idiom of
   `tests/unit/architecture/audit-log.test.ts`: the schema declares no `Mixed`,
   no `Object`, and no unbounded string path. An absence is only structural once
   something fails when it stops being true.

Clauses 1–3 are asserted by the architecture test in clause 4, and the
`set:` truncation is asserted by writing through the schema and reading the
stored document, so a caller that stops truncating fails rather than merely
becomes untidy.

**Lockout is its own event, and `recordFailedLogin` returns the flag.** This
finishes a decision rather than opening one. `withApi` already records that "an
operator asking 'is this account being credential-stuffed, and is it now locked?'
has nothing to read" (`src/shared/api/with-api.ts:306`); the mechanism simply is
not carrying what the code already says it must.

Lockout is a detection signal about a *named* account. Detection rules and
incident queries match on the event rather than aggregating `login_failed` rows
and inferring the lock from the end of a run. Collapsing the two makes the
question a rollup, and under the drop policy a *missing* lockout row then
becomes indistinguishable from a *dropped* one — the false-assurance problem
again, at the moment it costs most. It also contradicts this ADR's own reason for
`outcome` existing, which is that a failed sign-in cannot be inferred from an
absent row: collapsed, the lockout *moment* would be inferable only from the last
row of a run, a fragile inference over a collection that is permitted to drop
rows.

The flag is returned to the caller and the caller emits it.
`authenticateWithPassword` returns whether `recordFailedLogin` locked the
account; the lockout event is written by the route handler. Emitting from inside
`recordFailedLogin` would put an audit concern in the password service and invert
the layering this document otherwise preserves. Two lines in a private function,
and no change to what any endpoint returns.

Asserted in `tests/integration/auth/auth-event-log.test.ts`: the fifth consecutive
failure produces an `auth.lockout` row and not only an `auth.login_failed` one,
which is the observation that fails the moment the two are collapsed.

**Its own retention, deliberately different from `audit_logs`: 90 days.**
`auth_events` is written on every sign-in attempt, so it grows by an order of
magnitude more rows per user than any tenant collection, and it carries IP
addresses and user agents. What is decided here is that the two logs do not
share one retention: coupling them would mean a retention change made for tenant
audit also silently evicts sign-in history, or that sign-in volume forces a
retention change nobody made for tenant audit.

No retention at all was considered and rejected. Unbounded retention of IP
addresses and user agents is itself a data-minimisation exposure and a GDPR
target, and it contradicts the reason just given for a separate retention: that
trades a false-assurance risk for a compliance risk, which is the worse trade.
Recording the boundary was considered and rejected for the usual reason — any
such record requires a job, and there is no job to run it.

Ninety days exceeds the realistic investigation window for credential stuffing
and account takeover while keeping IP-address and user-agent exposure bounded. It
is a single exported constant beside `SESSION_TTL_DAYS`,
`PASSWORD_RESET_TTL_MINUTES`, `EMAIL_VERIFICATION_TTL_HOURS` and
`INVITATION_TTL_DAYS` — a four-for-four precedent — and deliberately not an
environment variable, because a retention period configuration can change is a
retention period nobody has decided. It is revisitable, and note that a 30-day
session TTL means a stale session row can outlive the event that explains it.

The account-owner read surface must **state the retention period** and must never
present "nothing before date X" as "you never signed in before date X". That
fixes the user-facing half of the ambiguity at no infrastructure cost.

One limitation is recorded rather than solved. MongoDB's TTL monitor emits no
event, no log line and no notification, and deletion is asynchronous, so an
investigator querying the raw collection still gets an empty result
indistinguishable from "it never happened". That is a property of the storage
layer. It is mitigated at the read surface, not solved. The TTL index is the
first in the repository that deletes a live record, and `docs/DATABASE.md` §8
names it as a deliberate exception to its own index rule. The index and its
period are asserted by `tests/unit/architecture/auth-event.test.ts`, so the
number in that document cannot drift from the number in the schema.

**Its own access control, and this is the part that is not a copy of the
existing policy.** Readable by the **account owner, and only the account
owner**. Not by organisation administrators, and not by anyone with
`audit.read`.

An organisation administrator being able to read who signed in to *another
member's* account is not an audit feature. It is a privilege-escalation surface:
it hands one member of an organisation a durable, timestamped, IP-attributed
record of when another member is at their desk, when they travel, when they are
off, and when their account is being used from somewhere they are not. That is
surveillance capability over a colleague, granted by a permission whose name
sounds like compliance. The blast radius of getting this wrong is worse than the
blast radius of the gap it closes, which is why it is decided here rather than
left to whoever writes the endpoint.

The asymmetry is deliberate and worth stating plainly: an organisation
administrator can read the *tenant* audit log, which records changes to shared
records. They cannot read the *account* event log, which records a person's
access to their own identity. Those are different subjects, and the second one is
not a team resource.

## Consequences

- Six of the nine handlers in `src/app/api/v1/auth` gain a write on paths that
  currently have none, two of which are pre-authentication and therefore
  unauthenticated. `me`, `resend-verification` and `verify-email` emit nothing,
  because the vocabulary above holds no event for them. The eight events fall to
  the other six handlers, and `login` is the one that can emit three of them on a
  single request — `auth.login_failed` or `auth.lockout` on a refusal,
  `auth.login` on a success.
- `auth.login_failed` and `auth.lockout` are written for a caller who has
  proved nothing. The `action` vocabulary is closed precisely so that a
  caller-supplied string cannot become a query.
- The architecture test that enforces append-only is duplicated, not shared.
  Two collections, two tests — a shared helper would be one edit away from
  asserting both at once, which is how a property stops being checked. The
  mirrored file also carries the schema-constraint assertions, because those are
  statements about absences in the same schema.
- Any future endpoint that authenticates writes here. Whether such an endpoint may
  write an event *without* the drop policy is not a per-call-site decision; see
  the write-failure policy above.
- `recordFailedLogin` gains a return value. No endpoint response changes, and no
  caller needs to branch on the new information for correctness.
- `docs/DATABASE.md` §8 records the collection and its 90-day retention, named as
  a deliberate exception to that document's rule that every index names the query
  it serves, and `docs/SECURITY.md` §12 records the manual detection query. §2's
  Audit row is updated when the code lands rather than now, because until then
  the events still are not written and the documentation should keep saying so.
