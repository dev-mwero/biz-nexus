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
  "meta": { "page": 1, "pageSize": 20, "total": 137, "totalPages": 7 }
}
```

**Failure**

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request is not valid.",
    "details": [ { "path": "email", "message": "Enter a valid email address." } ],
    "requestId": "9f2c1a54-0b3e-4d7a-8c21-6e5f0a7b4d19"
  }
}
```

`code` is stable and machine-readable. `message` is safe to display. `requestId`
correlates with the server log and is the only thing to quote in a bug report.

---

## 2. Error codes

Codes are specific rather than generic. `NOT_FOUND` and `CONFLICT` would force a
client to parse the human-readable `message` to work out which field to
highlight, which breaks translation and is the reason the code exists at all.
The single source of truth is `ERROR_CATALOGUE` in
`src/shared/errors/app-error.ts`; a contract test fails if this table and that
object disagree.

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Body could not be read as JSON |
| 400 | `INVALID_CURSOR` | Paging cursor unparseable |
| 400 | `TOKEN_NOT_REDEEMABLE` | Verification or reset link expired, never issued, or superseded |
| 401 | `UNAUTHENTICATED` | No session |
| 401 | `SESSION_EXPIRED` | Session expired or revoked |
| 403 | `INSUFFICIENT_PERMISSION` | Role lacks the permission |
| 403 | `ORIGIN_NOT_ALLOWED` | Mutating request did not come from `APP_URL` |
| 403 | `ACTIVE_ORGANIZATION_REQUIRED` | No active organisation, or not an active member of it |
| 403 | `MEMBERSHIP_INACTIVE` | Membership suspended |
| 403 | `EMAIL_NOT_VERIFIED` | Verification required before this action |
| 404 | `RECORD_NOT_FOUND` | Does not exist, **or** belongs to another organisation |
| 404 | `ORGANIZATION_UNAVAILABLE` | Organisation missing, inactive, or in another tenant |
| 404 | `MEMBERSHIP_NOT_FOUND` | Not a member of this organisation |
| 404 | `INVITATION_INVALID` | Unknown, or already replaced by a resend |
| 409 | `EMAIL_ALREADY_REGISTERED` | Duplicate email |
| 409 | `MEMBERSHIP_EXISTS` | Already a member of this organisation |
| 409 | `SLUG_CONFLICT` | Name taken and no free variant found |
| 409 | `ORGANIZATION_CREATION_FAILED` | Could not create the organisation |
| 409 | `ROLE_PROVISIONING_FAILED` | System roles already provisioned |
| 409 | `OWNER_REQUIRED` | Would leave the organisation with no active owner |
| 410 | `INVITATION_EXPIRED` | Past its seven-day window |
| 410 | `INVITATION_USED` | Already accepted |
| 410 | `INVITATION_REVOKED` | Revoked by an administrator |
| 422 | `VALIDATION_FAILED` | Schema validation failed; `details` lists the fields |
| 422 | `EMAIL_REQUIRED` | Address missing or blank |
| 422 | `ROLE_NOT_IN_ORGANIZATION` | Role id not usable in this organisation |
| 429 | `RATE_LIMITED` | Too many attempts; `Retry-After` header set |
| 500 | `INTERNAL` | Unexpected. Quote the `requestId`. |
| 500 | `TRANSACTION_ABORTED` | Transaction rolled back; retryable |
| 500 | `DATABASE_ERROR` | Database failure |
| 500 | `CONFIGURATION_INVALID` | Server misconfigured |

All `500` codes share one client message — `Something went wrong.` — and differ
only in the server log, keyed by `requestId`. A `500` that says which kind of
failure it was is a `500` that tells an attacker about the deployment.

A record in another organisation returns `404`, never `403`. See
[`SECURITY.md` §6](./SECURITY.md). `ROLE_NOT_IN_ORGANIZATION` is the one place
this is done with wording rather than status: the caller sent a role id that is
not usable here, and the message says "not available for this organization"
rather than confirming the role exists in a tenant they cannot see.

---

## 3. Authentication

Session cookie `bn_session`, `HttpOnly`, `SameSite=Lax`, `Secure` in production.

**Every mutating request must carry an `Origin` header**, and it must equal
`APP_URL`. `withApi` refuses anything else with `403 ORIGIN_NOT_ALLOWED`, and it
refuses a *missing* `Origin` too — fail closed, because a request with no origin
is indistinguishable from a request that deliberately omitted one. Browsers send
`Origin` on every non-`GET`/`HEAD` request, same-origin included, so a browser
client never has to think about this.

**Non-browser clients must send it explicitly.** `curl`, server-to-server calls
and native mobile clients all need `-H "Origin: $APP_URL"` (or the equivalent).
This is a real constraint on a v1 API and it is deliberate: a CSRF defence that
can be switched off per call site is not one. It is also the reason the check
lives in the wrapper rather than in each route — adding an endpoint gets the
check without deciding to.

There is no opt-out and no per-route exemption list. `GET`, `HEAD` and `OPTIONS`
are exempt because they are not mutating; a preflight carries no cookie.

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
| `POST` | `/auth/resend-verification` | authenticated | Reissue verification token. **Not yet rate limited** — see §10. |

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "owner@acme.com", "password": "correct horse battery staple" }
```

---

## 4. Activities

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/activities` | `activities.read` | Organisation feed, filterable by `type`, `actorId`, `ownerId`, `entityType`, `entityId`, `before` |
| `POST` | `/activities` | `activities.create` | Create note, call, or meeting. Body: `{ entityType, entityId, type: "NOTE"\|"CALL"\|"MEETING", title, body?, direction?, durationSeconds?, occurredAt? }` |
| `GET` | `/activities/:id` | `activities.read` | Get a single activity |
| `DELETE` | `/activities/:id` | `activities.create` | Delete own activity, or `settings.manage` |
| `GET` | `/activities/feed` | `activities.read` | Cursor-paginated organisation feed |

### Activity feed cursor pagination

`GET /activities/feed?cursor=<ObjectId>&limit=20&before=<ISO8601>`

Returns:
```json
{
  "data": {
    "activities": [ ... ],
    "nextCursor": "65f..."
  }
}
```

---

## 5. Audit logs

| Method | Path | Permission |
|---|---|---|
| `GET` | `/audit-logs` | `audit.read` |

---

## 6. CRM — Companies

Base path: `/crm/companies`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/crm/companies` | `companies.read` |
| `POST` | `/crm/companies` | `companies.create` |
| `GET` | `/crm/companies/:id` | `companies.read` |
| `PATCH` | `/crm/companies/:id` | `companies.update` |
| `DELETE` | `/crm/companies/:id` | `companies.delete` — soft delete |

**Filters:** `status`, `industry`, `ownerId`, `tag[]`, `createdFrom`, `createdTo`

---

## 7. CRM — Contacts

Base path: `/crm/contacts`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/crm/contacts` | `contacts.read` |
| `POST` | `/crm/contacts` | `contacts.create` |
| `GET` | `/crm/contacts/:id` | `contacts.read` |
| `PATCH` | `/crm/contacts/:id` | `contacts.update` |
| `DELETE` | `/crm/contacts/:id` | `contacts.delete` — soft delete |
| `POST` | `/crm/contacts/:id/merge` | `contacts.update` | Merge into another contact |

**Filters:** `status`, `companyId`, `ownerId`, `tag[]`, `createdFrom`, `createdTo`, `hasEmail`

---

## 8. CRM — Leads

Base path: `/crm/leads`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/crm/leads` | `leads.read` |
| `POST` | `/crm/leads` | `leads.create` |
| `GET` | `/crm/leads/:id` | `leads.read` |
| `PATCH` | `/crm/leads/:id` | `leads.update` |
| `DELETE` | `/crm/leads/:id` | `leads.delete` — soft delete |
| `POST` | `/crm/leads/:id/convert` | `leads.convert` | Convert to contact, optionally company and deal |
| `GET` | `/crm/leads/:id/convert-preview` | `leads.read` | Preview conversion without executing |

**Filters:** `status`, `source`, `ownerId`, `scoreMin`, `scoreMax`, `createdFrom`, `createdTo`

### Lead conversion

The most complex write in the MVP, so it gets an explicit contract.

```http
POST /api/v1/crm/leads/65f.../convert

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

---

## 9. CRM — Tags

Base path: `/crm/tags`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/crm/tags` | `tags.read` |
| `POST` | `/crm/tags` | `tags.create` |
| `GET` | `/crm/tags/:id` | `tags.read` |
| `PATCH` | `/crm/tags/:id` | `tags.update` |
| `DELETE` | `/crm/tags/:id` | `tags.delete` — soft delete |
| `POST` | `/crm/tags/:id/merge` | `tags.update` | Merge into another tag |

**Filters:** (none specific — use `q` for name search)

---

## 10. CRM — Custom field definitions

Base path: `/crm/field-definitions`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/crm/field-definitions?entityType=<type>` | `fieldDefinitions.read` |
| `POST` | `/crm/field-definitions` | `fieldDefinitions.create` |
| `GET` | `/crm/field-definitions/:id` | `fieldDefinitions.read` |
| `PATCH` | `/crm/field-definitions/:id` | `fieldDefinitions.update` |
| `DELETE` | `/crm/field-definitions/:id` | `fieldDefinitions.delete` — removes the value from records |

`entityType` ∈ `CONTACT` \| `COMPANY` \| `LEAD` \| `DEAL` \| `TASK`

---

## 11. CRM — Saved views

Base path: `/crm/saved-views`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/crm/saved-views?entityType=<type>` | `savedViews.read` |
| `POST` | `/crm/saved-views` | `savedViews.create` |
| `GET` | `/crm/saved-views/:id` | `savedViews.read` |
| `PATCH` | `/crm/saved-views/:id` | owner only, or `isShared` and `savedViews.update` |
| `DELETE` | `/crm/saved-views/:id` | owner only |

Filters are stored as validated data, never as a raw query string. This is both a
safety property and the reason `NoSQL injection` cannot reach a saved view.

---

## 12. Deals

Base path: `/deals`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/deals` | `deals.read` |
| `POST` | `/deals` | `deals.create` |
| `GET` | `/deals/:id` | `deals.read` |
| `PATCH` | `/deals/:id` | `deals.update` |
| `DELETE` | `/deals/:id` | `deals.delete` — soft delete |
| `POST` | `/deals/:id/move` | `deals.move` | Move to a stage |
| `POST` | `/deals/:id/win` | `deals.move` | Mark as won (moves to won stage) |
| `POST` | `/deals/:id/lose` | `deals.move` | Mark as lost (moves to lost stage, requires `reason`) |
| `GET` | `/deals/:id/timeline` | `deals.read` | Activity timeline for this deal |
| `GET` | `/deals/pipeline-board` | `deals.read` | Kanban board data |
| `GET` | `/deals/summary` | `deals.read` | Aggregated pipeline summary |

**Filters:** `status`, `pipelineId`, `stageId`, `companyId`, `contactId`, `ownerId`,
`valueMin`, `valueMax`, `closingFrom`, `closingTo`, `tag[]`

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

### Deal win / lose

```http
POST /api/v1/deals/65f.../win
```

```http
POST /api/v1/deals/65f.../lose
Content-Type: application/json

{ "reason": "Budget not approved" }
```

Convenience endpoints that move to the pipeline's won/lost stage respectively.

---

## 13. Dashboard

| Method | Path | Permission |
|---|---|---|
| `GET` | `/dashboard` | `dashboard.read` |

Returns all MVP dashboard metrics in a single round-trip using MongoDB `$facet` aggregation:
- Metric cards: deals won/lost this month, lead conversion rate, pipeline value, win rate
- Pipeline summary: deals by stage (count + total value)
- Overdue tasks count
- Recent activity (10 items)

---

## 14. Notifications

| Method | Path | Permission |
|---|---|---|
| `GET` | `/notifications` | `notifications.read` — own only |
| `GET` | `/notifications/stream` | `notifications.read` — Server-Sent Events for real-time updates |
| `GET` | `/notifications/unread-count` | `notifications.read` |
| `PATCH` | `/notifications/:id/read` | `notifications.update` |
| `POST` | `/notifications/read-all` | `notifications.update` |

### SSE stream

`GET /notifications/stream` returns a text/event-stream:
- Initial message: `{ "type": "unread-count", "count": N }`
- On new notification or mark-read: `{ "type": "unread-count", "count": N }`
- Heartbeat: `: heartbeat\n\n` every 30 seconds

---

## 15. Pipelines

Base path: `/pipelines`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/pipelines` | `pipelines.read` |
| `POST` | `/pipelines` | `pipelines.create` |
| `GET` | `/pipelines/:id` | `pipelines.read` |
| `PATCH` | `/pipelines/:id` | `pipelines.update` — includes atomic stage reorder |
| `DELETE` | `/pipelines/:id` | `pipelines.delete` — `409` if deals reference it |
| `POST` | `/pipelines/:id/reorder` | `pipelines.update` | Atomic stage reorder |

---

## 16. Search

| Method | Path | Permission |
|---|---|---|
| `GET` | `/search` | authenticated — contacts, companies, deals, tasks |

`/search` returns only what the caller may read, and always only within the
active organisation. It does not accept a type filter that reaches a collection
the caller has no permission for.

---

## 17. Tasks

Base path: `/tasks`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/tasks` | `tasks.read` |
| `POST` | `/tasks` | `tasks.create` |
| `GET` | `/tasks/:id` | `tasks.read` |
| `PATCH` | `/tasks/:id` | `tasks.update` |
| `DELETE` | `/tasks/:id` | `tasks.delete` — soft delete |

**Filters:** `status`, `priority`, `assigneeId`, `dueFrom`, `dueTo`, `overdue`, `relatedEntityType`,
`relatedEntityId`, `completedFrom`, `completedTo`

### Task completion

```http
PATCH /api/v1/tasks/65f...

{ "status": "DONE" }
```

Sets `completedAt` to now, `completedById` to the actor. Emits `task.completed`,
which produces a `TASK` activity on the task and all related entities
(contact, company, deal). The activity title is `Completed "Task name"`.

Reopening (`status: "TODO"` or `"IN_PROGRESS"`) clears `completedAt` and
`completedById` and emits `task.reopened`.

### Task assignment

```http
PATCH /api/v1/tasks/65f...

{ "assigneeId": "65a..." }
```

Emits `task.assigned`, which produces a `TASK` activity. Setting `assigneeId:
null` emits `task.unassigned`.

---

## 18. List query parameters

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
              relatedEntityId, completedFrom, completedTo
activities     type, actorId, ownerId, entityType, entityId, before
fieldDefs     entityType (required query param)
savedViews    entityType (required query param)
tags          (none specific)
```

**Unknown parameters are rejected**, not ignored. A typo in a filter that is
silently ignored returns plausible but wrong data, which is worse than an error.

**Pagination is offset-based in v1.** Correct and simple at MVP data volumes. If
an endpoint needs to page through tens of thousands of rows, that endpoint
switches to a cursor; cursor pagination is introduced at that point, not
speculatively now.

---

## 19. Status codes

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

## 20. Rate limits

**The limits below are the target, not the current state.** Of these, only the
5-consecutive-failures lockout is enforced today; it lives in the database, on
the `users` row, and is covered by the login suite. The per-IP and per-email
limits are task 1.31, and no auth route calls the rate-limit driver yet. This
section says so rather than being aspirational, because a table of limits with
no marker on which ones work is how a reviewer concludes the whole table works.

| Scope | Limit | Response | Enforced |
|---|---|---|---|
| `POST /auth/login` | 5 consecutive failures / account | 15-minute lockout | **yes** — database |
| `POST /auth/login` | 10 / 15 min / IP | `429` | no — 1.31 |
| `POST /auth/register` | 5 / hour / IP | `429` | no — 1.31 |
| `POST /auth/forgot-password` | 3 / hour / email | Always `200`; throttled silently | no — 1.31 |
| `POST /auth/resend-verification` | 3 / hour / user | Always `200`; throttled silently | no — 1.31 |
| `POST /auth/reset-password` | 5 / hour / IP | `429` | no — 1.31 |
| `POST /crm/contacts` etc. | 20 / day / organisation | `429` | no — not built |
| `GET /search` | 60 / minute / user | `429` | no — not built |
| Everything else | 300 / minute / user | `429` | no — not built |

Enforced behind a driver interface. The MVP driver is in-memory and therefore
per-instance on Vercel — sufficient for abuse resistance, **not** a security
boundary. See [`SECURITY.md` §9](./SECURITY.md).

---

## 21. Versioning

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

## 22. Conventions this API commits to

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

---

## 23. Endpoints NOT implemented (documented for clarity)

The following endpoints appear in earlier designs or related documentation but
are **not implemented** in the current codebase:

| Endpoint | Status | Notes |
|---|---|---|
| `POST /auth/accept-invitation` | Not implemented | Invitation acceptance not built |
| `POST /organizations` | Not implemented | Organisation creation not built |
| `GET /organizations/current` | Not implemented | Organisation management not built |
| `PATCH /organizations/current` | Not implemented | Organisation settings not built |
| `GET /organizations` | Not implemented | User's organisations list not built |
| `POST /organizations/active` | Not implemented | Organisation switching not built |
| `GET /organizations/current/members` | Not implemented | Member management not built |
| `POST /organizations/current/members/invitations` | Not implemented | Invitation management not built |
| `GET /organizations/current/invitations` | Not implemented | |
| `DELETE /organizations/current/invitations/:id` | Not implemented | |
| `PATCH /organizations/current/members/:id` | Not implemented | |
| `DELETE /organizations/current/members/:id` | Not implemented | |
| `POST /organizations/current/leave` | Not implemented | |
| `GET /organizations/current/roles` | Not implemented | Role management not built |
| `POST /organizations/current/roles` | Not implemented | |
| `PATCH /organizations/current/roles/:id` | Not implemented | |
| `DELETE /organizations/current/roles/:id` | Not implemented | |
| `GET /crm/companies/:id/contacts` | Not implemented | |
| `GET /crm/contacts/:id/companies` | Not implemented | Multi-company not built |
| `GET /crm/contacts/:id/timeline` | Not implemented | Use `/activities?entityType=CONTACT&entityId=:id` |
| `GET /crm/companies/:id/timeline` | Not implemented | Use `/activities?entityType=COMPANY&entityId=:id` |
| `GET /crm/tasks/:id/timeline` | Not implemented | Use `/activities?entityType=TASK&entityId=:id` |
| `GET /dashboard/pipeline` | Not implemented | Use `/deals/pipeline-board` |
| `GET /dashboard/tasks` | Not implemented | Use `/tasks` with filters |

These endpoints are tracked in the project plan and will be implemented in
subsequent phases.