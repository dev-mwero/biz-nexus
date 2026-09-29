# ADR-0003 — Tenant scoping lives in the repository, not in the caller

- **Status:** accepted
- **Date:** 2026-09-29
- **Affects:** every module, the Data Access Layer, the test suite

## Context

This is the decision the whole product's security rests on.

MongoDB has no row-level security and no schema-level tenant constraint. Every
query in the codebase is, by default, cross-tenant. A single query that omits
`organizationId` returns another customer's data — names, emails, phone
numbers, notes, deal values.

The naive approach is to require every call site to remember:

```ts
// This is wrong, and it will be wrong once.
Company.find({ _id: id, organizationId })
```

It is wrong because it depends on a developer having correct judgement at
several hundred call sites, under deadline, at 2am, during their third refactor
of the week. The failure is silent: the query works, returns another tenant's
data, and no test notices unless someone wrote a test for that exact call.

The requirement is to make the mistake *impossible to express*, not merely
unusual.

## Options considered

**A. Convention.** Document that every query filters by `organizationId` and
review for it. Rejected: it relies entirely on human vigilance, and the failure
mode is a security incident.

**B. A query middleware or hook** that injects `organizationId` into every
`find`. Rejected: it is global magic that is invisible at the call site, it
cannot distinguish a deliberately unscoped query, and it becomes very hard to
reason about when a legitimate cross-tenant operation exists — resolving an
invitation, for instance, which spans two contexts.

**C. Separate database per tenant.** Perfect isolation. Rejected for the MVP:
one database per organisation does not scale to thousands of organisations on
Atlas, migrations become N operations, and cross-tenant administrative queries
become impossible.

**D. A tenant-scoped repository base class** that captures `organizationId` at
construction and merges it into every filter it issues. **Chosen.**

## Decision

```ts
class TenantRepository<T extends TenantDocument> {
  constructor(
    protected readonly model: Model<T>,
    protected readonly organizationId: string,
  ) {}

  find(filter: Filter<T>, opts?: FindOptions) {
    return this.model.find({ ...filter, organizationId: this.organizationId }, opts);
  }

  findById(id: string) {
    return this.model.findOne({ _id: id, organizationId: this.organizationId });
  }

  updateOne(filter, update) {
    return this.model.updateOne({ ...filter, organizationId: this.organizationId }, update);
  }

  deleteOne(filter) { /* same merge */ }
}
```

`organizationId` is set in the constructor. It is not a parameter to any method,
so no call site can pass the wrong one, omit it, or override it.

**Two escape hatches, both deliberate and both named for what they are:**

- `findUnscoped(reason: string, filter)` — requires a string explaining why, so
  every use is greppable and reviewable. Used only by identity resolution
  (finding a user by email during login, which is inherently pre-tenant) and by
  invitation acceptance.
- `aggregate(pipeline)` — for reporting aggregates, which must still include an
  `$match` on `organizationId` as the first stage. A dedicated
  `TenantAggregateRepository` enforces it.

**Rule: modules never import a Mongoose model directly.** They import their
repository. Raw model access is a review finding.

## Supporting layers

The repository is layer one of three. Each is independently insufficient.

1. **Structural** — the repository cannot issue an unscoped query by accident.
2. **Schema** — every tenant collection requires `organizationId`; every index
   is prefixed by it. An unscoped query on a real collection degrades to a
   collection scan, so a mistake is slow in development instead of invisible in
   production.
3. **Test** — a dedicated isolation suite asserts that a record from another
   organisation returns `404` from every route and every service, *including
   when the caller is Owner of both organisations*.

The third case is the one that matters most. An implementation that scopes by
"the user's current organisation" and is handed an explicit id from another
organisation will happily return that record. Only a test that constructs
exactly that situation catches it.

## Rationale

The goal is to convert a decision that must be made correctly hundreds of times
into a type that cannot be constructed wrong. The organisation id is captured
once, at the boundary, by the only component that talks to the database — and
every consumer of that repository is automatically scoped, including code
written later by someone who has not read this document.

This also makes the correct code the shortest code. `repo.findById(id)` is
shorter than `Company.findOne({ _id: id, organizationId })`, so the secure path
is also the lazy path. Security that costs extra effort gets skipped under
deadline; security that saves effort gets used.

## Trade-offs accepted

| Consequence | Mitigation |
|---|---|
| An aggregate is not a simple `find` and needs its own wrapper | `TenantAggregateRepository` requires the leading `$match`; tested |
| Genuinely cross-tenant operations need an escape hatch | `findUnscoped(reason)` is greppable and reviewable; currently only two uses |
| Slightly more ceremony in tests | Factories take an `organizationId`, so a cross-tenant test is the same code with one argument changed |
| A repository per collection is boilerplate | Generated from a single generic base; typically under 60 lines each |

## Consequences for the codebase

- A service receives an already-scoped repository; it never constructs one with
  a client-supplied id.
- A `TenantRepository` is created per request in the Data Access Layer from the
  session's active organisation — never from a request body.
- Adding a new tenant-owned collection means adding a repository. It is the step
  at which scoping is decided, deliberately, rather than discovered later.
- Direct `Model.find` outside a repository is a code-review rejection.
