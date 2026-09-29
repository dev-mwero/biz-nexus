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

```
src/
├── app/                          # routing only
│   ├── (marketing)/              # public: landing, pricing
│   ├── (auth)/                   # sign in, register, reset
│   ├── (app)/                    # authenticated shell
│   │   ├── layout.tsx            # sidebar, header, org switcher
│   │   ├── dashboard/
│   │   ├── contacts/  companies/  leads/  deals/
│   │   ├── pipelines/  tasks/  activities/  notifications/
│   │   └── settings/{profile,organization,members,roles,security}
│   └── api/v1/                   # versioned REST surface
│       ├── auth/  organizations/  members/  roles/
│       ├── contacts/  companies/  leads/  deals/  pipelines/
│       ├── tasks/  activities/  notifications/  tags/  custom-fields/
│       ├── saved-views/  audit-logs/  search/  dashboard/
│
├── modules/                      # domain logic; no React, no HTTP
│   ├── identity/                 # user, session, password, verification
│   ├── organizations/            # org, membership, invitation
│   ├── rbac/                     # permission catalogue, roles, guards
│   ├── crm/
│   │   ├── contacts/  companies/  leads/  deals/  tags/
│   ├── pipelines/
│   ├── activities/
│   ├── tasks/
│   ├── notifications/
│   ├── audit/
│   ├── reporting/                # dashboard + metrics
│   └── custom-fields/            # field definitions
│
├── shared/                       # infrastructure used by many modules
│   ├── auth/                     # DAL: getSession, requireUser, requirePermission
│   ├── db/                       # connection, TenantRepository, mixins
│   ├── errors/                   # AppError taxonomy
│   ├── validation/               # base zod helpers
│   ├── query/                    # pagination, sorting, filter parsing
│   ├── events/                   # typed in-process bus
│   ├── responses/                # ok/fail envelopes
│   ├── drivers/                  # mail, ratelimit, queue, storage interfaces
│   └── lib/                      # cn, formatters, ids, dates
│
├── components/
│   ├── ui/                       # design-system primitives
│   ├── layout/                   # app shell, sidebar, header
│   ├── crm/  tasks/  activities/ # domain composites
│   └── forms/                    # form field compositions
│
├── styles/                       # tokens
├── proxy.ts
└── env.ts
```

### Module internal shape

Every domain module uses the same four files, so any module can be read in
thirty seconds:

```
src/modules/crm/contacts/
├── contact.schema.ts      # Mongoose schema + indexes
├── contact.types.ts       # TypeScript types, inferred where possible
├── contact.validation.ts  # Zod schemas for create, update, list, params
├── contact.repository.ts  # tenant-scoped data access
├── contact.service.ts     # business rules; emits events
├── contact.events.ts      # event payloads this module emits / consumes
└── index.ts               # public surface of the module
```

**Rule:** a module never imports from another module's internals. It imports
from another module's `index.ts`, or receives the coupling through the event
bus. Cross-module writes happen in the owning module's service, or in an
explicit orchestration service in `shared/`.

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
   both organisations.
3. **Review** — a lint rule and a code-review checklist flag raw model access
   outside a repository.

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
| Integration | Vitest + `mongodb-memory-server` | repositories, indexes, service+repo, real queries | separate DB per suite |
| API contract | Vitest | every route handler: status, envelope, validation | real DB, real session |
| Authorization | Vitest | the permission matrix and the tenant matrix | real DB, two organisations |
| e2e | Playwright | the critical path and the isolation path | seeded fixtures |

The authorization suite is not optional and is not a subset of the API contract
suite. It exists to answer one question continuously: *can organisation A reach
organisation B?* The expected answer is always no.

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
