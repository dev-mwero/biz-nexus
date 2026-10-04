# Architecture

Companion documents: [`DATABASE.md`](./DATABASE.md) · [`SECURITY.md`](./SECURITY.md) ·
[`API.md`](./API.md) · [`decisions/`](./decisions)

---

## 1. Principles

1. **One tenant boundary, enforced in one place.** Organisation scoping is the
   property of a repository, not of a function that remembers to check.
2. **Services hold the logic. Adapters are thin.** Route handlers and Server
   Actions are HTTP and form adapters. Neither contains business rules.
3. **Guard at the data, not at the edge.** `proxy.ts` performs optimistic
   redirects. Real authorization happens in the Data Access Layer, on every
   read and write, because Server Actions bypass the proxy matcher.
4. **Configuration is data.** Pipelines, roles, tag colours, custom fields and
   lead sources are documents. Code ships the mechanism.
5. **Events decouple, they do not orchestrate.** An in-process bus carries
   `deal.stage_changed` to activity, audit and notification subscribers. It is
   explicitly non-durable, and nothing may depend on delivery for correctness.
6. **Fail closed.** A missing permission, a missing organisation, or an
   unresolvable record produces 403/404, never a partial result.
7. **Portable over platform-specific.** No Vercel-only API in domain code. The
   mailer, rate limiter, queue and storage are all interfaces with drivers.

---

## 2. Runtime shape

```
                      ┌──────────────────────────────┐
  Browser ───────────▶│  Vercel Edge Network         │
                      └──────────────┬───────────────┘
                                     ▼
                      ┌──────────────────────────────┐
                      │  src/proxy.ts                │  optimistic only:
                      │  cookie present? redirect.   │  no database access
                      └──────────────┬───────────────┘
                                     ▼
        ┌────────────────────────────────────────────────────────┐
        │  Next.js 16 App Router (Node runtime per function)     │
        │                                                        │
        │   route handler ─┐                                     │
        │   server action ─┼─▶ guards ─▶ service ─▶ repository   │
        │   server comp  ──┘   (DAL)              (tenant-scoped)│
        │                                    │                   │
        │                                    ├─▶ domain events  │
        │                                    └─▶ audit + notify  │
        └───────────────┬────────────────────────┬───────────────┘
                        ▼                        ▼
              ┌───────────────────┐    ┌──────────────────────┐
              │ MongoDB 8 / Atlas │    │ Driver interfaces    │
              │ Mongoose 9       │    │ mail / rate / queue  │
              └───────────────────┘    │ storage              │
                                       └──────────────────────┘
```

Serverless consequences, all of which are designed for rather than discovered:

- **One connection per warm instance.** Cached on `globalThis`, small pool,
  bounded server-selection timeout. Never a new client per request.
- **No in-process durability.** Events, caches and rate-limit counters are best
  effort and must be replaceable by external drivers before they are load-bearing.
- **No long-lived workers.** Deferred job execution is a driver interface from
  day one, so Stage 7 can adopt a queue without rewriting the domain.

---

## 3. Directory layout

As built. This section used to describe the layout as *designed*, which is how it
came to list a `src/styles/`, a `src/shared/validation/` and a
`src/shared/drivers/` that do not exist, and to omit `src/db/`,
`src/shared/api/` and `src/shared/http/` — the last of which every handler in
`src/app/api` runs through. Design intent belongs in the ADRs; a tree that
disagrees with the repository sends people looking for files that were never
going to be there.

```
src/
├── app/                          # routing only
│   ├── (auth)/                   # sign-in, sign-up, forgot/reset password
│   ├── (app)/                    # authenticated shell
│   │   ├── app/                  # module index
│   │   ├── dashboard/
│   │   ├── crm/{contacts,companies,leads,tags,saved-views,custom-fields}/
│   │   ├── deals/{,[id],kanban,new}/
│   │   ├── pipelines/{,[id],new}/
│   │   ├── tasks/{,[id],new}/  activities/  notifications/  search/
│   │   └── settings/             # one screen, currently a placeholder
│   ├── onboarding/  dev/ui/      # org creation, design-system playground
│   └── api/v1/                   # versioned REST surface
│       ├── auth/  organizations/  members/  roles/
│       ├── crm/{contacts,companies,leads,tags,saved-views,custom-fields}/
│       ├── pipelines/  deals/  tasks/  activities/  notifications/
│       └── audit-logs/  search/  dashboard/
│
├── modules/                      # domain logic; no React, no HTTP
│   ├── identity/                 # user, session, password, verification
│   ├── organizations/            # org, membership, invitation
│   ├── rbac/                     # permission catalogue, roles, guards
│   ├── crm/                      # contacts, companies, leads, tags, saved views
│   ├── pipelines/
│   ├── deals/
│   ├── dashboard/                # cross-domain metrics
│   ├── activities/
│   ├── tasks/
│   ├── notifications/
│   └── audit/                    # global, tenant-free auth event log (ADR-0006)
│
├── db/                           # persistence primitives every module shares
│   ├── connection.ts             # serverless-safe cached connect (ADR-0001)
│   ├── tenant-repository.ts      # the structural tenancy boundary (ADR-0003)
│   ├── transaction.ts
│   └── mixins/                   # soft-delete, audit-stamped fields
│
├── shared/                       # infrastructure used by many modules
│   ├── auth/                     # DAL: getSession, requireUser, requirePermission
│   ├── api/                      # withApi, parseBody, same-origin assertion
│   ├── http/                     # method-not-allowed, route param helpers
│   ├── errors/                   # AppError taxonomy
│   ├── query/                    # pagination, sorting, filter parsing
│   ├── events/                   # typed in-process bus
│   ├── responses/                # ok/fail envelopes
│   └── lib/                      # cn, formatters, ids, dates
│
├── components/
│   ├── ui/                       # design-system primitives
│   ├── app-shell/                # sidebar, header, org switcher
│   ├── providers/                # theme, session, toast
│   └── auth/  crm/  deals/  pipelines/  tasks/  activities/
│       dashboard/  notifications/  # domain composites, form compositions
│
├── proxy.ts                      # optimistic unauthenticated redirect
├── instrumentation.ts
└── env.ts                        # validated environment
```

Three layout facts worth stating, because each is easy to violate by accident:

- **`src/db/` and `src/shared/` are not interchangeable.** `db/` holds the one
  tenancy primitive every module depends on; `shared/` holds what more than one
  module happens to use. Moving `TenantRepository` into `shared/` would file the
  boundary among the things permitted to vary, which is the opposite of its
  purpose.
- **There is no `src/shared/validation/`.** Validation lives beside what it
  validates, as `*.validation.ts` inside a module, because a schema shared by two
  unrelated domains is a schema that will be edited by one of them for the other's
  reason.
- **`components/` has no `layout/` and no `forms/` shell.** Chrome is
  `app-shell/`, cross-cutting React context is `providers/`, and a form's
  composition lives with the feature that owns it rather than in one shared bucket
  that every feature contributes to and none owns.

### Module internal shape

Domain modules are split by entity, not by layer — `src/modules/crm/` holds one
service, repository and model per entity rather than a `contacts/` folder with
seven files in it. Two modules did not fit that and carry `*.schemas.ts` and
`*.constants.ts` instead (`identity`, `deals`).

```
src/modules/crm/
├── contact.model.ts        # Mongoose schema + indexes
├── contact.repository.ts   # tenant-scoped data access
├── contact.service.ts      # business rules; emits events
├── company.model.ts  company.repository.ts  company.service.ts  company.events.ts
├── lead.model.ts      lead.repository.ts   lead.service.ts       lead.events.ts
├── tag.model.ts       tag.repository.ts    tag.service.ts
├── saved-view.model.ts   saved-view.repository.ts   saved-view.service.ts
├── field-definition.*                          # custom fields
├── crm.events.ts          # payloads this module emits / consumes
└── index.ts               # public surface of the module
```

`.types.ts` was in the original design and is not here: every type is inferred
from the model or the Zod schema it belongs to, and a hand-maintained
`*.types.ts` next to both is a third place for the same shape to drift.

**Rule:** a module never imports from another module's internals. It imports
from another module's `index.ts`, or receives the coupling through the event
bus. Cross-module writes happen in the owning module's service, or in an
explicit orchestration service in `shared/`.

**Request-shaped validation lives in the route, not here.** `src/app/api/v1/crm/contacts/route.ts`
declares its own `contactFiltersSchema`. A list filter is a property of the HTTP
contract for that collection — pagination defaults, which sort keys are legal, what
`hasEmail` means as a query string — and it is exactly the thing most likely to
differ between the list endpoint, the export, and the UI that calls them. Keeping
one definition per consumer is what stops those three disagreeing.

---

## 4. Request lifecycle

Every authenticated data path follows the same seven steps, in this order.

```
1  AUTHENTICATE   verifySession()        session exists, not expired, not revoked
2  RESOLVE ORG    requireOrg()           org from session; never from input
3  AUTHORIZE      requirePermission()    role → permission code → allow/deny
4  VALIDATE       zod schema             reject unknown keys, coerce, bound size
5  EXECUTE        service → repository  repository forces the org filter
6  RECORD         audit + activity       via the event bus
7  RESPOND        ok() envelope          or AppError → mapped status
```

**Step 2 is the security-critical one.** There is no request parameter, query
string, or body field named `organizationId` that the server will honour. The
only way to change the active organisation is `POST /api/v1/organizations/active`,
which validates membership and updates the session. A body that contains
`organizationId` has it stripped by the validation schema, not trusted.

**Step 5 is the structural one.** `TenantRepository` is constructed with an
organisation id and merges it into every filter it issues. There is no code path
that queries a tenant collection without it.

---

## 5. Tenancy enforcement

```ts
// shared/db/tenant-repository.ts — the shape, not the real file
class TenantRepository<T> {
  constructor(protected readonly organizationId: string) {}

  find(filter: Filter<T>) {
    return this.model.find({ ...filter, organizationId: this.organizationId });
  }
  // every method merges the scope; the override escape hatch is
  // named `findUnscoped` and requires an explicit reason argument
}
```

Three layers of defence, in order of preference:

1. **Structural** — the repository cannot issue an unscoped query by accident.
2. **Test** — the isolation suite asserts that every route and every service
   returns 404/403 for a foreign record id, including for a user who is Owner of
   both organisations (`tests/integration/security/cross-tenant-isolation.test.ts`,
   `tests/integration/db/tenant-isolation.test.ts`).
3. **Review** — a code-review checklist item. There is no lint rule for raw model
   access outside a repository; this section used to claim one, and a documented
   control that does not exist is worse than an undocumented one, because it is
   checked off. `TenantRepository.findUnscoped` and `findUnscopedById` are the
   deliberate escape hatches and both demand a reason string
   (`assertReason`) — grep for those calls and each one should have an argument
   explaining why the scope is safe to drop.

Server components read through the same services as the API. There is no
"trusted" server-side path that skips authorization.

---

## 6. Errors and responses

```ts
// Success
{ "data": <payload>, "meta": { "page": 1, "pageSize": 20, "total": 137, "totalPages": 7 } }

// Failure
{ "error": { "code": "RECORD_NOT_FOUND", "message": "Deal not found.",
             "details": [...], "requestId": "9f2c1a54-…" } }
```

`AppError` carries a stable machine code, a safe human message, an optional
field-level `details` array, and an HTTP status. Unexpected errors are logged
with a request id and returned as a generic 500 — internal messages, stack
traces and driver errors never reach a client.

Cross-tenant access returns **404, not 403**, for a record that exists in another
organisation. Returning 403 would confirm the record's existence, which is itself
a leak. Permission failures on a *known* action return 403.

---

## 7. Domain events

```ts
// shared/events
emit("deal.stage_changed", {
  organizationId, actorId, dealId,
  fromStageId, toStageId, occurredAt,
});
```

Typed via a registry mapping event name to payload, so a typo is a compile
error. Subscribers are registered at module load by the owning module. A
subscriber that throws is caught, logged and isolated; it cannot fail the
request that emitted the event.

Events the MVP emits: `user.registered`, `organization.created`,
`membership.invited`, `membership.joined`, `contact.created`, `contact.updated`,
`company.created`, `lead.created`, `lead.converted`, `deal.created`,
`deal.stage_changed`, `deal.won`, `deal.lost`, `task.created`, `task.assigned`,
`task.completed`, `task.overdue`, `notification.created`.

**This is the seam for Stage 7.** When the automation engine arrives it
subscribes to the same events; it does not get a second, parallel hook system.

---

## 8. Caching

Not enabled for the MVP, deliberately. Authenticated CRM data is
organisation-scoped and permission-filtered, which makes cache keys and
invalidation a real design problem rather than a configuration detail. Data is
read fresh from MongoDB on each navigation.

`cacheComponents` stays off. Public marketing pages are static; the application
is dynamic by design. The list-query layer and index set are the performance
strategy, and they are correct at every scale this product will realistically
reach before Stage 9.

If caching is added later it must be organisation-scoped, permission-scoped, and
invalidate on the same events the audit log already records.

---

## 9. Frontend architecture

- **Server Components by default.** Lists and detail pages fetch through
  services on the server. Client Components are islands: forms, dialogs, menus,
  the Kanban board, the activity composer.
- **Mutations go through Server Actions** that call the same services as the
  route handlers. The UI never calls its own HTTP API.
- **Server Actions are treated as public endpoints.** They re-run the full guard
  chain. Nothing is trusted because it rendered a button.
- **Forms:** `react-hook-form` + `zodResolver`, with the *same* Zod schema the
  API uses, so client and server validation cannot drift.
- **Server state is not cached in a global store.** The request already returns
  fresh data; a client cache is a second source of truth with no benefit.
  `useActionState` handles form results.
- **Design system:** tokens in CSS, primitives in `src/components/ui/`, domain
  composites in `src/components/<domain>/`. No page invents its own table.
- **Accessibility is a component property.** A new primitive ships with focus
  management, keyboard behaviour and ARIA semantics, or it does not ship.

---

## 10. Testing strategy

| Layer | Tool | Covers | Isolation |
|---|---|---|---|
| Unit | Vitest | services, guards, formatters, validators, pure logic | none needed |
| Architecture | Vitest | invariants a review cannot see: guard-before-body, catalogue/doc/handler agreement, append-only audit, tenancy in the repository | none needed |
| Integration | Vitest + `mongodb-memory-server` | repositories, indexes, service+repo, real queries | separate DB per suite |
| API contract | Vitest, `tests/integration/api/` | every route handler: status, envelope, validation | real DB, real session |
| Authorization | Vitest, `tests/integration/rbac/` and `security/` | the permission matrix and the tenant matrix | real DB, two organisations |
| e2e | Playwright | the critical path and the isolation path | throwaway in-memory replica set |

The authorization suite is not optional and is not a subset of the API contract
suite. It exists to answer one question continuously: *can organisation A reach
organisation B?* The expected answer is always no.

Two things about the e2e layer are worth being precise about, because the table
above used to imply the opposite of both:

- **Playwright is not driving a browser here.** `e2e/critical-path.spec.ts` and
  `e2e/isolation-path.spec.ts` exercise `/api/v1` through the `request` fixture,
  not the UI. That is a deliberate trade — the critical path is a sequence of API
  calls whose interesting failures are status codes and envelopes, and a browser
  adds flake without adding signal. What it means is that **nothing tests what a
  user sees**. Rendering, client-side navigation, form submission and the
  org-switcher round trip are covered by unit and integration tests of the server
  pieces, not by anything that loads a page.
- **The database is clean by construction.** `scripts/e2e-server.mjs` boots a
  fresh in-memory replica set for each run, so "from a clean database" needs no
  cleanup step and a run cannot see a previous run's state.

**Components have no unit coverage.** `vitest.config.mts` excludes
`src/components/**` from the coverage gate and no test file imports a `.tsx` from
`src/components`. This is the largest known gap and it is tracked as open in
[`PLAN.md`](./PLAN.md) §1K; it is written here rather than left for a reader to
discover from a coverage report.

---

## 11. What is deliberately absent

| Absent | Why | When it arrives |
|---|---|---|
| Microservices | A single deployable is correct at this scale. Splitting now makes every transaction a distributed one. | Never, probably |
| Event broker | In-process is sufficient and honest about its limits | Stage 7, if workflow volume demands it |
| Caching layer | Wrong trade at organisation-scoped, permission-filtered data | Post-Stage 9, measured |
| Repository interfaces over Mongoose | Speculative abstraction; only one implementation is real | When a second one exists |
| Generic form builder | Would weaken type safety and the shared design system | Never |
| Plugin system | No second consumer | Stage 11 integrations |
