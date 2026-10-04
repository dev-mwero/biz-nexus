# Roadmap

Fourteen stages, seven gates. Each stage is a separate planning exercise,
executed only after the preceding gate passes.

Task-level execution plans live in [`PLAN.md`](./PLAN.md). Architecture-level
decisions live in [`decisions/`](./decisions).

---

## Stage overview

| Stage | Theme | Primary domains added | Gate to enter |
|---|---|---|---|
| 0 | Discovery | — | complete |
| 1 | MVP Foundation | identity, organisations, rbac, crm, pipelines, activities, tasks, notifications, audit | approved |
| 2 | Sales and customer management | products, services, quotations, sales orders | Gate 1 |
| 3 | Finance | invoices, payments, expenses, receivables, payables | Gate 2 |
| 4 | Inventory and procurement | warehouses, stock movements, suppliers, purchase orders | Gate 3 |
| 5 | Communication | internal messages, channel provider abstractions | Gate 4 |
| 6 | Unified inbox | conversations, assignment, omnichannel routing | Gate 5 |
| 7 | Automation and workflows | triggers, conditions, actions, execution history | Gate 6 |
| 8 | Business playbooks | reusable operational processes | Gate 7 |
| 9 | Reporting and analytics | crm, finance, inventory, operations reports | — |
| 10 | Documents and files | attachments, object storage, access control | — |
| 11 | Integrations | provider adapters, public API keys, webhooks | — |
| 12 | SaaS billing | plans, trials, subscriptions, seats, usage | — |
| 13 | AI assistance | CRM, sales, finance, inventory, and business assistants | Gate 7 |

Stages 9 to 12 have no entry gate because each is independent of the others and
can be entered once the core domains are stable. They are ordered by commercial
value, not by dependency.

---

## Gates

### Gate 1 — after Stage 1

```
[x] The critical path passes end to end from a clean database
[ ] Organisation A cannot reach Organisation B by URL, API, or inference
[x] Every endpoint has a permission test
[x] No open high or critical security finding
[ ] CI green on a clean checkout
[ ] Every feature meets the ten-part definition of done
```

Three of six. The permission criterion is closed on evidence rather than on a
sample: all 88 endpoints are compared guard-to-documentation in
`tests/unit/architecture/route-permissions.test.ts` and asserted to refuse in
`tests/integration/rbac/route-permission-enforcement.test.ts`. The three open
criteria, and what each is still missing, are tracked in
[`PLAN.md`](./PLAN.md) §1K. `by inference` is the one to read closely — it is the
only criterion here that no amount of per-route assertion will satisfy on its own.

### Gate 2 — after Stage 2

Sales and customer management are stable: quotes convert to orders without data
loss, a customer 360 view assembles from the existing activity substrate, and
product pricing is a single source of truth reused by later domains.

### Gate 3 — after Stage 3

Finance is stable: invoice lifecycle, payments, and receivables reconcile, and
SaaS billing has not been confused with customer finance. The accounting basis
(cash vs accrual) is decided here, not improvised.

### Gate 4 — after Stage 4

Core business domains are stable: stock quantities are only ever changed by an
auditable stock movement, and procurement reconciles against inventory.

### Gate 5 — after Stage 5

Core domains plus communication are stable: the provider abstraction can be
exercised with at least two real channels behind one interface.

### Gate 6 — after Stage 7 (automation)

Automation is stable: workflows have execution history, retry behaviour,
idempotency, loop protection, and tenant isolation. Playbooks build on this and
must not become a second automation engine.

### Gate 7 — before Stage 13 (AI)

Structured business data is reliable and permissions are trustworthy. AI may
never bypass authorization; it reads through the same guards as the UI.

---

## Sequencing rationale

**Why CRM before Finance.** Finance needs customers, products, prices and
documents. Building it first means inventing all of them badly.

**Why Finance before Inventory.** Inventory movements are triggered by purchases
and sales, and their cost basis comes from the product and purchase records. It
also depends on the decision made at Gate 2 about how cost is treated.

**Why Automation last among the core domains.** A workflow engine writes rules
against entities. Rules written against unstable entities produce automation
that is confidently wrong — the most expensive kind of bug in this product.

**Why AI last, always.** AI inherits every flaw in the substrate beneath it. It
can summarise a data leak; it cannot prevent one.

---

## What "done" means for a stage

A stage is complete when, for every feature it added:

- the user interface exists and is usable, including empty, loading and error
  states
- the API exists, is versioned, and is documented in `docs/API.md`
- the data model is documented in `docs/DATABASE.md` and indexed for the
  queries that use it
- inputs are validated server-side
- authorization is enforced and covered by an automated test
- errors are typed and returned in the standard envelope
- unit, integration and authorization tests exist and pass
- the security review found nothing open at high or critical
- the documentation matches the code

A page existing is not a stage. A page that exists, is protected, is tested, is
documented and cannot leak is a stage.

---

## Explicitly not on the roadmap

Recorded so their absence is understood as a decision:

- Full double-entry bookkeeping or a general ledger
- Native mobile applications
- Offline-first synchronisation
- Multi-region active/active data residency
- White-label reselling
- A public template or app marketplace
- Self-hosted deployment support
