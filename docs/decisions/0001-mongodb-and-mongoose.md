# ADR-0001 — MongoDB and Mongoose as the datastore

- **Status:** accepted
- **Date:** 2026-09-29
- **Deciders:** project owner, lead architect
- **Affects:** every domain module

## Context

The product is a multi-tenant Business OS whose first shipped domain is CRM.
The access pattern is overwhelmingly "list this entity, filtered, for one
organisation, ordered by date". Relationships are shallow and mostly
parent-to-child. Schemas will grow substantially over the fourteen stages, and
new entities will appear that nobody has specified yet.

The decision was made against a running MongoDB 8.0.26 already present on the
development machine, and a body of existing work — five sibling Next.js
projects, all using Mongoose — that established a house style worth reusing.

## Options considered

**MongoDB + Mongoose** — flexible schema, a single-node local instance already
available, zero infrastructure setup for development, and consistent with the
existing codebase. Costs: no foreign keys, no schema migrations, no
`CHECK` constraints, and connection handling that must be written carefully for
a serverless runtime.

**PostgreSQL + Drizzle** — real referential integrity and `CHECK` constraints,
strong aggregate support for the Finance and Reporting stages, excellent
compound indexes. Costs: no server running locally, more setup, and it diverges
from every sibling project.

**PostgreSQL + Prisma** — as above, plus a code-generation step on every schema
change and a heavier runtime. The generation step slows iteration during exactly
the phase where the schema changes most.

## Decision

**MongoDB with Mongoose.**

Compensating controls, all mandatory, are specified in
[`DATABASE.md`](../DATABASE.md):

1. `organizationId` is required on every tenant-owned collection.
2. Referential integrity is enforced in the service layer — a write that
   references another document must load it and assert same-organisation.
3. Multi-document invariants use transactions. Local development uses a
   single-node replica set so transactions are available.
4. Every index is prefixed by `organizationId`.
5. Deletes are soft wherever dependents exist.

## Rationale

The deciding factor is fit to the current problem, not theoretical capability.
The MVP is organisation-scoped document retrieval with shallow relationships.
MongoDB models that directly, and the absence of a database server would have
been a real cost in the first week.

The deeper reason is continuity. The team already writes and debugs Mongoose
code daily. A schema that matches existing fluency gets reviewed carefully; a
new one gets reviewed carelessly during the phase where a mistake is most
expensive.

## Trade-offs accepted

| Consequence | Mitigation |
|---|---|
| No foreign keys; orphans are possible | Service-level validation, transactions for multi-write invariants, and a reconciliation pass once data volume justifies it |
| No schema migrations | Mongoose validators enforce shape at write time; a validator change is a deployment, not a migration |
| Join queries are manual | CRM reads are document-shaped, not join-shaped. Aggregation pipeline is used only where the report genuinely needs it |
| Connection management must be deliberate | `globalThis` cache, small pool, `bufferCommands: false`, documented in `DATABASE.md` §11 |
| Reporting in Stage 9 is harder | Accepted. Atlas Search and aggregation pipelines cover the expected volumes |

## Revisit when

Full double-entry accounting enters scope (Stage 3). A ledger has
constraints — balanced entries, immutable periods — that document stores do not
enforce naturally. If Stage 3 becomes a real accounting product rather than
invoicing, a relational store for the finance domain alone, or the whole
system, should be reconsidered at Gate 2.

## Alternatives not chosen

- **Polyglot (Mongo for CRM, Postgres for finance).** Two databases, two sets of
  failure modes, two deployment stories, for a product whose finance stage is
  years away.
- **Postgres for everything.** The better long-term relational answer, rejected
  on present fit and cost, not on merit.
