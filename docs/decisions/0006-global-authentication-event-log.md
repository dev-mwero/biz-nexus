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

So the seven highest-value security events in the system are unaudited: sign-in,
sign-out, sign-out-everywhere, registration, password reset requested, password
reset completed, and account lockout. These are not the events an organisation
administrator is curious about. They are the events an investigator needs when
somebody asks whether an account was taken over, and they are the events whose
absence is why an account takeover is hard to prove after the fact.

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

**Its own retention, deliberately different from `audit_logs`.** `auth_events`
is written on every sign-in attempt, so it grows by an order of magnitude more
rows per user than any tenant collection, and it carries IP addresses and user
agents. A shorter retention for a higher-volume, more-sensitive log is the
ordinary answer; the retention period is set when the task is implemented and
recorded in `docs/DATABASE.md §8` beside the collection. What is decided here is
that the two logs do not share one: coupling them would mean a retention change
made for tenant audit also silently evicts sign-in history, or that sign-in
volume forces a retention change nobody made for tenant audit.

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

- The nine handlers in `src/app/api/v1/auth` gain a write on paths that
  currently have none, including two that are pre-authentication and therefore
  unauthenticated. The write must not be able to fail the request it is
  describing: a sign-in that succeeds and then 500s because the log write failed
  is a worse outcome than a missing row, and the failure path is its own event.
- `auth.login_failed` and `auth.lockout` are written for a caller who has
  proved nothing. The `action` vocabulary is closed precisely so that a
  caller-supplied string cannot become a query.
- The architecture test that enforces append-only is duplicated, not shared.
  Two collections, two tests — a shared helper would be one edit away from
  asserting both at once, which is how a property stops being checked.
- Any future endpoint that authenticates writes here. There is no opt-out list,
  for the same reason there is none for the `Origin` check: a control that can
  be switched off per call site is not a control.
- `docs/SECURITY.md` §2's Audit row and §12's gap table are updated when this
  lands, so the documentation and the code stop disagreeing about whether
  sign-ins are recorded.
