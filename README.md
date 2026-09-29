# BizNexus

A multi-tenant **Business Operating System** for small and medium-sized B2B
organisations. CRM is the first domain shipped; the architecture is a modular
business platform, not a CRM with extra screens.

> **Status: Phase 0 — Discovery complete. Phase 1 has not started.**
> No application code exists yet. This repository currently contains
> documentation, decisions, and a validated build toolchain.

---

## What this is

Tenants are **organisations**. A user may belong to several, with a different
role in each. Everything — contacts, companies, leads, deals, pipelines,
activities, tasks, notifications, audit records — belongs to exactly one
organisation, and the boundary is enforced structurally rather than by
convention.

The long-term shape:

```
Business OS
├── Identity & Access      multi-tenant auth, per-organisation RBAC
├── CRM                   contacts, companies, leads
├── Sales                 pipelines, deals, quotations, orders
├── Finance               invoices, payments, expenses, receivables
├── Inventory             warehouses, stock movements, procurement
├── Communication         internal messages, email, SMS, WhatsApp
├── Activities            one unified timeline across every domain
├── Tasks                 assignable work with due dates
├── Automation            triggers, conditions, actions
├── Playbooks             reusable operational processes
├── Reporting             CRM, finance, inventory, operations
├── Documents             attachments and files
├── Integrations          provider adapters
├── AI                    assistance across all of the above
└── SaaS Billing          plans, trials, subscriptions, seats
```

Only the first row is built now. See [`docs/ROADMAP.md`](./docs/ROADMAP.md) for
the fourteen stages and the seven gates that guard them.

---

## Stack

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js 16 (App Router) | Turbopack, React Compiler, React 19 |
| Language | TypeScript, `strict` | No `any`, no `eslint` — [Next 16 removed `next lint`](./docs/DISCOVERY.md) |
| Styling | Tailwind CSS v4 | Tokens in CSS via `@theme`; no config file |
| Lint / format | Biome 2 | Lint and format in one tool |
| Database | MongoDB 8 + Mongoose 9 | Local in development, Atlas on Vercel. [ADR-0001](./docs/decisions/0001-mongodb-and-mongoose.md) |
| Sessions | Opaque token, SHA-256 hashed at rest | Not JWT — revocability is a requirement. [ADR-0002](./docs/decisions/0002-custom-session-auth.md) |
| Authorization | Per-organisation roles, code-level permission catalogue | [ADR-0004](./docs/decisions/0004-per-organization-roles.md) |
| Validation | Zod, `.strict()` everywhere | The same schema validates the form and the API |
| Testing | Vitest + `mongodb-memory-server`, Playwright | Authorization suite is mandatory |
| Hosting | Vercel | Serverless constraints designed for, not discovered |

MongoDB 8.0.26 is already running locally on `127.0.0.1:27017`.

---

## Three decisions that shape everything

**1. Tenant scoping is structural, not conventional.** A
`TenantRepository` captures `organizationId` at construction and merges it into
every query it issues. No call site passes it, so no call site can forget it. The
correct code is also the shorter code.
[ADR-0003](./docs/decisions/0003-tenant-scoped-repositories.md)

**2. Sessions are revocable by design.** A JWT cannot be logged out before it
expires. An opaque 32-byte token, stored as a SHA-256 hash, can be revoked
instantly and audited. A leaked database yields no usable credentials.
[ADR-0002](./docs/decisions/0002-custom-session-auth.md)

**3. Logic lives in services, never in adapters.** Route handlers and Server
Actions are peers over a shared service layer, so business logic exists once.
Both run the identical guard chain, because a Server Action is a public HTTP
endpoint that happens to be referenced by a button.
[ADR-0005](./docs/decisions/0005-service-layer-and-adapters.md)

---

## Getting started

```bash
npm install
cp .env.example .env.local     # set SESSION_SECRET: openssl rand -base64 32
npm run dev
```

MongoDB is already available locally. Transactions require a replica set:

```bash
mongod --replSet rs0 --dbpath .mongo-data
mongosh --eval "rs.initiate()"
```

```bash
npm run validate     # biome + tsc — the gate for every commit
```

---

## Documentation

Everything is written down, and the reasoning matters more than the result.

| Document | What it answers |
|---|---|
| [`docs/DISCOVERY.md`](./docs/DISCOVERY.md) | What the repository looked like, what the environment is, which skills are installed, what is still open |
| [`docs/PRODUCT.md`](./docs/PRODUCT.md) | What the product is, who it is for, the MVP boundary, the non-negotiable principles |
| [`docs/PLAN.md`](./docs/PLAN.md) | **The master plan** — every task, in order, one commit each |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Fourteen stages, seven gates, and why they are in that order |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Directory layout, the seven-step request lifecycle, tenancy enforcement, error envelopes, the event bus |
| [`docs/DATABASE.md`](./docs/DATABASE.md) | Every collection, every field, every index and the query it serves |
| [`docs/SECURITY.md`](./docs/SECURITY.md) | Threat model, the request checklist, session design, the isolation test matrix, accepted risks |
| [`docs/API.md`](./docs/API.md) | The v1 REST contract |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How to write, test, and commit in this repository |

---

## Working rules

1. **One commit per logical change.** Conventional Commits, no exceptions.
2. **Nothing commits while `npm run validate` is red.**
3. **A feature is not done because it renders.** It is done when it has UI, API,
   database, validation, authorization, error handling, loading and empty
   states, tests, and documentation.
4. **A stage does not advance on green tests alone.** It advances on its gate.
5. **Documentation changes in the same commit as the code it describes.**
6. **Architectural changes come with an ADR.**
7. **When in doubt, prefer the design that makes a cross-tenant leak impossible
   over the one that makes it unlikely.**

---

## Licence

Unpublished. All rights reserved.
