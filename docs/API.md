# API Reference — v1

Base path `/api/v1`. JSON in, JSON out. Every response is one of two shapes,
without exception.

Related: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`SECURITY.md`](./SECURITY.md) ·
[`DATABASE.md`](./DATABASE.md)

---

## 1. Envelopes

**Success — single record**

```json
{ "data": { "id": "65f...", "name": "Acme Ltd" } }
```

**Success — collection**

```json
{
  "data": [ { "id": "65f..." }, { "id": "65g..." } ],
  "meta": { "page": 1, "pageSize": 20, "total": 137, "totalPages": 7, "hasNext": true }
}
```

**Failure**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request body is invalid.",
    "details": [ { "path": "email", "message": "Enter a valid email address." } ],
    "requestId": "01JBX7QK2M9F4N6P8R0S2T4V6X"
  }
}
```

`code` is stable and machine-readable. `message` is safe to display. `requestId`
correlates with the server log and is the only thing to quote in a bug report.

---

## 2. Error codes

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed request |
| 401 | `UNAUTHENTICATED` | No session, expired, or revoked |
| 403 | `FORBIDDEN` | Authenticated, but the role lacks the permission |
| 403 | `EMAIL_NOT_VERIFIED` | Verification required before this action |
| 404 | `NOT_FOUND` | Does not exist, **or** belongs to another organisation |
| 409 | `CONFLICT` | Duplicate — email already registered, tag exists |
| 409 | `INVALID_STATE` | Invalid transition, e.g. converting an already-converted lead |
| 422 | `VALIDATION_ERROR` | Schema validation failed; `details` lists the fields |
| 429 | `RATE_LIMITED` | Too many attempts; `Retry-After` header set |
| 500 | `INTERNAL_ERROR` | Unexpected. Quote the `requestId`. |

A record in another organisation returns `404`, never `403`. See
[`SECURITY.md` §6](./SECURITY.md).

---

## 3. Authentication

Session cookie `bn_session`, `HttpOnly`, `SameSite=Lax`, `Secure` in production.

**There is no `organizationId` parameter anywhere in this API.** The active
organisation is read from the session. The only way to change it is
`POST /organizations/active`, which verifies membership first.

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/auth/register` | — | Create an account. Returns the user, sets a session. |
| `POST` | `/auth/login` | — | Email and password. Sets a session. |
| `POST` | `/auth/logout` | authenticated | Revoke the current session. |
| `POST` | `/auth/logout-all` | authenticated | Revoke every session for the user. |
| `GET` | `/auth/me` | authenticated | Current user, active organisation, role, permissions. |
| `POST` | `/auth/forgot-password` | — | Always `200`, whether or not the account exists. |
| `POST` | `/auth/reset-password` | — | Consume a single-use token. Revokes all sessions. |
| `POST` | `/auth/verify-email` | — | Consume a verification token. |
| `POST` | `/auth/resend-verification` | authenticated | Reissue. Rate limited. |

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "owner@acme.com", "password": "correct horse battery staple" }
```

---

## 4. Organisations and members

| Method | Path | Permission |
|---|---|---|
| `POST` | `/organizations` | authenticated — creates and joins |
| `GET` | `/organizations/current` | `organization.read` |
| `PATCH` | `/organizations/current` | `settings.manage` |
| `GET` | `/organizations` | authenticated — the user's organisations |
| `POST` | `/organizations/active` | authenticated — switch; verifies membership |
| `GET` | `/organizations/current/members` | `users.read` |
| `POST` | `/organizations/current/members/invitations` | `users.invite` |
| `GET` | `/organizations/current/invitations` | `users.read` |
| `DELETE` | `/organizations/current/invitations/:invitationId` | `users.invite` |
| `PATCH` | `/organizations/current/members/:membershipId` | `users.update` |
| `DELETE` | `/organizations/current/members/:membershipId` | `users.remove` |
| `POST` | `/organizations/current/leave` | authenticated |
| `GET` | `/organizations/current/roles` | `users.read` |
| `POST` | `/organizations/current/roles` | `settings.manage` |
| `PATCH` | `/organizations/current/roles/:roleId` | `settings.manage` |
| `DELETE` | `/organizations/current/roles/:roleId` | `settings.manage` — system roles are `409` |
| `POST` | `/auth/accept-invitation` | — token in the body |

Accepting an invitation is the only path that creates a membership without an
authenticated inviter, and it is bound to a single-use token that names the
organisation and the role.

---

## 5. CRM resources

Shared across contacts, companies, leads, deals and tasks.

| Method | Path | Permission |
|---|---|---|
| `GET` | `/{resource}` | `{resource}.read` |
| `POST` | `/{resource}` | `{resource}.create` |
| `GET` | `/{resource}/:id` | `{resource}.read` |
| `PATCH` | `/{resource}/:id` | `{resource}.update` |
| `DELETE` | `/{resource}/:id` | `{resource}.delete` — soft delete |
| `POST` | `/{resource}/:id/restore` | `{resource}.update` |

`resource` ∈ `contacts`, `companies`, `leads`, `deals`, `tasks`.

**Additional endpoints**

| Method | Path | Permission |
|---|---|---|
| `POST` | `/leads/:id/convert` | `leads.convert` |
| `GET` | `/leads/:id/convert-preview` | `leads.read` |
| `POST` | `/deals/:id/move` | `deals.move` |
| `GET` | `/deals/pipeline-board` | `deals.read` |
| `GET` | `/deals/summary` | `deals.read` |
| `GET` | `/companies/:id/contacts` | `companies.read` |
| `GET` | `/contacts/:id/companies` | `contacts.read` — future multi-company |
| `GET` | `/contacts/:id/timeline` | `contacts.read` |
| `GET` | `/deals/:id/timeline` | `deals.read` |
| `GET` | `/companies/:id/timeline` | `companies.read` |
| `GET` | `/tasks/:id/timeline` | `tasks.read` |

### Lead conversion

The most complex write in the MVP, so it gets an explicit contract.

```http
POST /api/v1/leads/65f.../convert

{
  "createContact": true,
  "createCompany": true,
  "createDeal": true,
  "deal": {
    "name": "Acme — Annual Retainer",
    "pipelineId": "65a...",
    "stageId": "65b...",
    "value": 24000,
    "expectedCloseDate": "2026-12-31"
  },
  "customFields": { "contract_type": "retainer" }
}
```

Runs in a transaction. Creates the contact, optionally the company, optionally
the deal; updates the lead to `CONVERTED` with the resulting ids; records one
`lead.converted` event, which produces a `SYSTEM_EVENT` activity and an audit
entry.

**Idempotent.** A second call returns `409 INVALID_STATE`, and includes
`convertedContactId` / `convertedDealId` so the caller can recover the result.

```json
{
  "error": {
    "code": "INVALID_STATE",
    "message": "This lead has already been converted.",
    "details": [{ "path": "leadId", "convertedContactId": "65c...", "convertedDealId": "65d..." }]
  }
}
```

### Deal stage move

```http
POST /api/v1/deals/65f.../move

{ "stageId": "65e...", "sortOrder": 0, "reason": "Signed verbal agreement" }
```

Validates that the stage belongs to the deal's pipeline, updates the deal,
emits `deal.stage_changed`. That event produces a `STAGE_CHANGE` activity
recording both stage names, and an audit entry with a before/after diff. A move
into a stage flagged `isWon` or `isLost` sets `status`, `closedAt`, and
`lostReason` where applicable, and emits `deal.won` or `deal.lost`.

---

## 6. Pipelines, tags, custom fields, saved views

| Method | Path | Permission |
|---|---|---|
| `GET` | `/pipelines` | `pipelines.read` |
| `POST` | `/pipelines` | `pipelines.create` |
| `GET` | `/pipelines/:id` | `pipelines.read` |
| `PATCH` | `/pipelines/:id` | `pipelines.update` — includes atomic stage reorder |
| `DELETE` | `/pipelines/:id` | `pipelines.delete` — `409` if deals reference it |
| `GET` | `/tags` | `contacts.read` |
| `POST` | `/tags` | `contacts.create` |
| `PATCH` | `/tags/:id` | `contacts.update` |
| `DELETE` | `/tags/:id` | `contacts.delete` |
| `GET` | `/custom-fields/:entityType` | `{entity}.read` |
| `POST` | `/custom-fields` | `settings.manage` |
| `PATCH` | `/custom-fields/:id` | `settings.manage` |
| `DELETE` | `/custom-fields/:id` | `settings.manage` — removes the value from records |
| `GET` | `/saved-views/:entityType` | `{entity}.read` |
| `POST` | `/saved-views` | `{entity}.create` |
| `PATCH` | `/saved-views/:id` | owner only, or `isShared` and `{entity}.update` |
| `DELETE` | `/saved-views/:id` | owner only |

---

## 7. Activities, tasks, notifications, audit, dashboard, search

| Method | Path | Permission |
|---|---|---|
| `GET` | `/activities` | `activities.read` — organisation feed, filterable |
| `POST` | `/activities` | `activities.create` — note, call, meeting |
| `GET` | `/activities/:id` | `activities.read` |
| `DELETE` | `/activities/:id` | `activities.create` — author or `settings.manage` |
| `GET` | `/notifications` | `notifications.read` — own only, always |
| `PATCH` | `/notifications/:id/read` | `notifications.update` |
| `POST` | `/notifications/read-all` | `notifications.update` |
| `GET` | `/notifications/unread-count` | `notifications.read` |
| `GET` | `/audit-logs` | `audit.read` |
| `GET` | `/dashboard` | `reports.view` |
| `GET` | `/dashboard/pipeline` | `reports.view` |
| `GET` | `/dashboard/tasks` | `reports.view` |
| `GET` | `/search` | authenticated — contacts, companies, deals, tasks |

`/search` returns only what the caller may read, and always only within the
active organisation. It does not accept a type filter that reaches a collection
the caller has no permission for.

---

## 8. List query parameters

One convention across every collection. Never a bespoke parameter set.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `page` | integer ≥ 1 | `1` | |
| `pageSize` | integer 1–100 | `20` | Hard maximum. Larger requests are `422`, not truncated. |
| `sort` | string | per resource | `-createdAt` for descending. Allow-listed per resource. |
| `q` | string ≤ 200 | — | Full-text search. Escaped before becoming a regex. |
| `sortBy` + `sortDir` | string + `asc`\|`desc` | — | Alternative explicit form |

Resource-specific filters, all optional, all validated:

```
contacts      status, companyId, ownerId, tag[], createdFrom, createdTo, hasEmail
companies     status, industry, ownerId, tag[], createdFrom, createdTo
leads         status, source, ownerId, scoreMin, scoreMax, createdFrom, createdTo
deals         status, pipelineId, stageId, companyId, contactId, ownerId,
              valueMin, valueMax, closingFrom, closingTo, tag[]
tasks         status, priority, assigneeId, dueFrom, dueTo, overdue, relatedEntityType,
              relatedEntityId
activities     type, actorId, ownerId, entityType, entityId, from, to
```

**Unknown parameters are rejected**, not ignored. A typo in a filter that is
silently ignored returns plausible but wrong data, which is worse than an error.

**Pagination is offset-based in v1.** Correct and simple at MVP data volumes. If
an endpoint needs to page through tens of thousands of rows, that endpoint
switches to a cursor; cursor pagination is introduced at that point, not
speculatively now.

---

## 9. Status codes

| Code | Used for |
|---|---|
| `200` | Successful read, update, or action with no resource |
| `201` | Resource created — `Location` header set |
| `204` | Successful delete with no body |
| `400` | Malformed request |
| `401` | Missing or invalid session |
| `403` | Permission denied |
| `404` | Not found in this organisation |
| `409` | Conflict — duplicate, or invalid state transition |
| `422` | Validation failed; `details` populated |
| `429` | Rate limited; `Retry-After` set |
| `500` | Unexpected error; `requestId` for correlation |

---

## 10. Rate limits

| Scope | Limit | Response |
|---|---|---|
| `POST /auth/login` | 10 / 15 min / IP, plus 5 consecutive failures / account | `429`, or a 15-minute lockout |
| `POST /auth/register` | 5 / hour / IP | `429` |
| `POST /auth/forgot-password` | 3 / hour / email | Always `200`; throttled silently |
| `POST /auth/reset-password` | 5 / hour / IP | `429` |
| `POST /organizations/current/members/invitations` | 20 / day / organisation | `429` |
| `GET /search` | 60 / minute / user | `429` |
| Everything else | 300 / minute / user | `429` |

Enforced behind a driver interface. The MVP driver is in-memory and therefore
per-instance on Vercel — sufficient for abuse resistance, **not** a security
boundary. See [`SECURITY.md` §9](./SECURITY.md).

---

## 11. Versioning

Path-based: `/api/v1`. A breaking change means `/api/v2`, and `v1` continues to
be served until no client uses it.

**Breaking:** removing a field, renaming a field, narrowing a type, changing a
status code for an existing condition, removing an endpoint.

**Not breaking:** adding an endpoint, adding an optional field, adding a filter
parameter, adding an enum value that clients already handle as unknown.

Adding an enum value is not breaking only if clients are written to tolerate it.
Every enum in this API is documented as open, and clients must render an unknown
value as a neutral fallback rather than crashing.

---

## 12. Conventions this API commits to

1. `organizationId` is never an input.
2. The response envelope never varies by endpoint.
3. Error `code` values are stable; `message` is human-facing and may change.
4. Every list endpoint paginates the same way.
5. Unknown query parameters are an error.
6. Deletes are soft and reversible; `409` when a reference prevents a hard
   delete.
7. A record in another organisation is `404`.
8. Timestamps are ISO 8601 UTC.
9. IDs are opaque strings in JSON. MongoDB `ObjectId` is a storage detail, not
   part of the contract.
10. Money is a decimal number in major units plus a `currency` code.
