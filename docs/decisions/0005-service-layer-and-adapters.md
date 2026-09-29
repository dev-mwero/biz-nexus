# ADR-0005 — Services hold the logic; route handlers and Server Actions are thin adapters

- **Status:** accepted
- **Date:** 2026-09-29
- **Affects:** every module, `src/shared/responses`, `src/shared/query`

## Context

Next.js App Router offers two ways to mutate data from the React tree, and the
product specification requires a versioned REST API as well:

- **Server Actions** — a form or component calls a function. Ergonomic, typed,
  no fetch, no serialisation, progressive enhancement for free.
- **Route Handlers** at `/api/v1/*` — HTTP endpoints. Required by the product
  spec, and the surface a future mobile app or third-party integration will use.

The obvious failure is implementing the same business logic twice: once in a
Server Action for the UI and once in a route handler for the API. The two copies
then drift, and the copy nobody tests is the one with the security bug.

There is a third option: have the UI fetch its own REST API. Rejected — it
serialises every keystroke-level interaction through HTTP, loses end-to-end
typing, and turns every form into three files.

## Options considered

**A. Server Actions only.** No REST API. Simplest possible. Rejected: the
product spec requires a versioned API, and integrations are a planned stage.

**B. Route handlers only; the UI calls its own API.** One implementation. Costs
a network round trip per mutation, loses type inference across the boundary,
and makes every mutation a client-side concern. Rejected.

**C. Route handlers and Server Actions both call one service layer. Chosen.**

**D. Server Actions call the route handlers internally.** Rejected: constructing
a `Request` to call your own handler is indirection with no benefit, and it
couples the UI to HTTP status codes.

## Decision

```
      Server Component ──▶ Service ──▶ TenantRepository ──▶ MongoDB
      Server Action    ──┘    ▲
      Route Handler    ──┘    │
                             └── domain events ──▶ activity / audit / notification
```

Each module exposes `contact.service.ts`. A route handler parses the request,
calls the service, maps the result to an envelope. A Server Action calls the same
service. **Neither contains a business rule.**

Both are public HTTP entry points, and both run the identical guard chain:

```ts
// route handler
export const POST = withApi("deals.create", async (req) => {
  const session = await requireSession(req);
  const org = await requireOrganization(session);
  await requirePermission(org, "deals.create");
  const input = createDealSchema.parse(await req.json());
  return created(await dealService.create(org, session.userId, input));
});

// server action — the same three guards, from the same module
"use server";
export async function createDealAction(input: unknown) {
  const session = await requireSession();
  const org = await requireOrganization(session);
  await requirePermission(org, "deals.create");
  const parsed = createDealSchema.parse(input);
  return dealService.create(org, session.userId, parsed);
}
```

Neither calls the other. They are peers over a shared dependency.

**Supporting decisions:**

- `withApi(scope, handler)` is a higher-order function taking a permission code.
  Authorization is a parameter of the route, not a line a developer may forget.
- The list-query Zod schema is defined per resource and used by both the route
  handler and any Server Action that lists, so pagination and filtering cannot
  diverge.
- Form validation uses the *same* Zod schema as the API, via `zodResolver`.
  Client-side and server-side validation are literally the same object.
- `src/modules/*/index.ts` is the only public surface of a module. Another
  module importing a service is fine; importing a repository or a Mongoose model
  across a module boundary is not.

## Rationale

One implementation of every business rule means the test suite tests the real
thing, and the second entry point cannot diverge because there is no second copy
to diverge from.

The `withApi` signature matters as much as the service layer. Making permission a
parameter of the wrapper converts authorization from something a developer must
remember into something a developer must state. Forgetting to call
`requirePermission` is now a compile error, not a security finding.

Sharing the Zod schema between the form and the endpoint is the quiet win. When
the `deals.create` contract changes, the form updates because the same type
changed, and a form that submits a field the server rejects is a bug that cannot
be written.

## Trade-offs accepted

| Consequence | Mitigation |
|---|---|
| Two entry points to remember | Both are one-liners over a service; the module `index.ts` shows the intended shape |
| Services must not assume an HTTP context | They take plain arguments and return domain results. `AppError` carries a status, mapped by the adapter. This is a genuine constraint, and a good one |
| Server Actions are not covered by the API contract suite | They get the same guard chain and are exercised by the Playwright suite, which drives the real UI |
| `withApi` hides the handler signature | TypeScript infers the context and return type from the generic; handlers stay fully typed |

## Why Server Actions still need guards

Server Actions are POST endpoints. A `proxy.ts` matcher that excludes a path
also excludes Server Functions on that path, and a session cookie is
`SameSite=Lax` rather than a bearer token. A Server Action must be assumed
reachable by anyone who can obtain the action id.

Every action re-runs `requireSession`, `requireOrganization` and
`requirePermission`. The guard chain in a Server Action is not redundant with
the layout check, because a layout does not re-render on navigation and does not
gate rendering at all.

## Revisit when

A public, API-key-authenticated surface is needed for Stage 11 integrations.
That adds a *third* adapter — a key-authenticated route handler — over the same
services, with scope resolution derived from the key rather than from a session.
The structure already accommodates it; nothing about the service layer changes.
