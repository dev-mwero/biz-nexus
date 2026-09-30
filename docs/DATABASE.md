# Data Model

MongoDB 8 · Mongoose 9 · database `biz_nexus` (development), Atlas in production.

Conventions used throughout this document:

- `camelCase` in Mongoose, `snake_case` for anything externally visible.
- `organizationId` is `ObjectId` and is **mandatory** on every tenant-owned
  collection. Not optional, not nullable.
- `_id` is the default `ObjectId`; never a business identifier.
- Soft delete via `deletedAt: Date | null`; only `deletedAt: null` is ever
  matched unless a restore or an audit view needs otherwise.
- `createdAt` / `updatedAt` are automatic. `createdBy` / `updatedBy` are
  `ObjectId` references to `User`, set by the service layer.
- Every index is listed because every index is a cost paid on every write.

Related: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`SECURITY.md`](./SECURITY.md) ·
[ADR-0001](./decisions/0001-mongodb-and-mongoose.md) ·
[ADR-0003](./decisions/0003-tenant-scoped-repositories.md)

---

## 1. Index strategy

MongoDB has no row-level security. The isolation guarantee is therefore built
from three index shapes that make an unscoped query *impossible to perform
efficiently*, which in turn makes the repository guard the only practical path:

**Primary access pattern — a list within an organisation, ordered**

```js
{ organizationId: 1, <filter fields>: 1, <sort field>: -1, _id: -1 }
```

The `organizationId` prefix is non-negotiable. A compound index only serves
queries whose leading fields are constrained, so leading with `organizationId`
means a missing scope produces a collection scan — visibly slow, and caught in
development rather than in production at scale.

**Secondary pattern — a record with a foreign key**

```js
{ organizationId: 1, companyId: 1, createdAt: -1 }
```

**Text search**

```js
{ organizationId: 1, name: "text", email: "text", description: "text" }
```

Text indexes are per-collection and must be declared explicitly; they are not
created implicitly.

**Rule against blind indexing.** An index that no query in the codebase uses is
write amplification for nothing. Every index below names the query it serves.
When a query is added, its index is added in the same commit. There is exactly
one exception — the `auth_events` retention TTL in §8, which serves no query
because it exists to delete, and which is named there rather than left for the
next reader of this paragraph to trip over.

**`explain()` before optimising.** A collection is not "slow"; a specific query
against a specific shape is. Use the `mongodb-query-optimizer` skill rather than
guessing.

---

## 2. Identity

### `users`

Global, not tenant-owned. A user exists before and independently of any
organisation.

| Field | Type | Notes |
|---|---|---|
| `email` | `String` | Lower-cased and trimmed on write. **Unique.** |
| `name` | `String` | Required, 1–120 |
| `passwordHash` | `String` | bcrypt, cost 12. Never selected by default. |
| `avatarUrl` | `String?` | |
| `emailVerifiedAt` | `Date?` | Null means unverified |
| `lastLoginAt` | `Date?` | |
| `failedLoginCount` | `Number` | Default 0; reset on success |
| `lockedUntil` | `Date?` | Set by the rate limiter after repeated failures |
| `status` | `String` | `ACTIVE` \| `SUSPENDED` |
| `preferences` | `Mixed` | Timezone, locale, date and currency format |

**Indexes**

| Index | Serves |
|---|---|
| `{ email: 1 }` unique | Login, registration uniqueness, password reset |
| `{ email: 1, passwordHash: 1 }` | Nothing — a compound unique on `email` already covers the lookup. **Not created.** |

`passwordHash` uses `select: false`, so it is absent unless explicitly requested.
This is a defence against a stray `findOne` leaking it into a log line or an API
response.

### `sessions`

| Field | Type | Notes |
|---|---|---|
| `userId` | `ObjectId` | Indexed |
| `tokenHash` | `String` | SHA-256 of the cookie token. Unique. The raw token exists nowhere else. |
| `activeOrganizationId` | `ObjectId?` | Null until the user joins or creates an organisation |
| `userAgent` | `String?` | Truncated to 255 |
| `ip` | `String?` | Truncated |
| `expiresAt` | `Date` | 30 days, sliding |
| `lastUsedAt` | `Date` | |
| `revokedAt` | `Date?` | Soft revocation, so revocation is auditable |

**Indexes**

| Index | Serves |
|---|---|
| `{ tokenHash: 1 }` unique | Every authenticated request |
| `{ userId: 1, revokedAt: 1 }` | "Active sessions" list, revoke-all |
| `{ expiresAt: 1 }` TTL `expireAfterSeconds: 0` | Automatic cleanup, no cron |

### `password_reset_tokens`

| Field | Type | Notes |
|---|---|---|
| `userId` | `ObjectId` | |
| `tokenHash` | `String` | Unique. Single use. |
| `expiresAt` | `Date` | 1 hour |
| `usedAt` | `Date?` | Set on redemption; rejects replay |
| `requestIp` | `String?` | |

**Indexes**: `{ tokenHash: 1 }` unique · `{ expiresAt: 1 }` TTL ·
`{ userId: 1, createdAt: -1 }` (rate limiting resets per user)

### `email_verification_tokens`

Same shape as `password_reset_tokens` with a different TTL (24 hours). Kept as a
separate collection so a cleanup index on one cannot evict the other's tokens.

---

## 3. Organisations and access control

### `organizations`

| Field | Type | Notes |
|---|---|---|
| `name` | `String` | 1–120 |
| `slug` | `String` | Lowercase, URL-safe, **globally unique** |
| `logoUrl` | `String?` | |
| `timezone` | `String` | IANA, default `UTC` |
| `currency` | `String` | ISO 4217, default `USD` |
| `dateFormat` | `String` | Default `YYYY-MM-DD` |
| `weekStartsOn` | `Number` | 0–6 |
| `settings` | `Mixed` | Notification preferences, default lead sources |
| `createdBy` | `ObjectId` | User |
| `isActive` | `Boolean` | Default true |

**Indexes**: `{ slug: 1 }` unique · `{ createdAt: -1 }`

### `roles`

Roles are **per organisation**, stored as documents rather than referenced from a
global template. This costs four documents per organisation and buys per-tenant
customisation without a second model, and it guarantees an organisation can never
read or mutate another's role definitions.

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | Indexed |
| `key` | `String` | `OWNER` \| `ADMIN` \| `MEMBER` \| `VIEWER`, or a custom key |
| `name` | `String` | Display name, editable |
| `description` | `String?` | |
| `permissions` | `[String]` | Permission codes from the catalogue |
| `isSystem` | `Boolean` | True for the four defaults. System roles may be renamed and their permissions edited, but not deleted or created over. |
| `isDefault` | `Boolean` | True for `MEMBER`; used when inviting |

**Indexes**: `{ organizationId: 1, key: 1 }` unique

### `memberships`

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | Indexed |
| `userId` | `ObjectId` | Indexed |
| `roleId` | `ObjectId` | Ref `Role`, must belong to the same organisation |
| `status` | `String` | `INVITED` \| `ACTIVE` \| `SUSPENDED` |
| `title` | `String?` | Job title shown in the member directory |
| `invitedBy` | `ObjectId?` | User |
| `invitedAt` | `Date?` | |
| `joinedAt` | `Date?` | |
| `lastActiveAt` | `Date?` | |

**Indexes**

| Index | Serves |
|---|---|
| `{ organizationId: 1, userId: 1 }` unique | One membership per user per organisation; the "am I a member?" check |
| `{ userId: 1, status: 1 }` | "My organisations" switcher |
| `{ organizationId: 1, status: 1, lastActiveAt: -1 }` | Member directory |

### `invitations`

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | Indexed |
| `email` | `String` | Lower-cased |
| `roleId` | `ObjectId` | Role granted on acceptance |
| `tokenHash` | `String` | Unique |
| `invitedBy` | `ObjectId` | User |
| `expiresAt` | `Date` | 7 days |
| `acceptedAt` | `Date?` | |
| `revokedAt` | `Date?` | |

**Indexes**: `{ tokenHash: 1 }` unique · `{ organizationId: 1, email: 1 }`
(unique partial on `acceptedAt: null` — one open invitation per address) ·
`{ expiresAt: 1 }` TTL

---

## 4. CRM

### `companies`

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | Indexed |
| `name` | `String` | 1–160 |
| `legalName` | `String?` | |
| `industry` | `String?` | Free text; no fixed enum |
| `website` | `String?` | Validated URL |
| `email` | `String?` | |
| `phone` | `String?` | E.164-ish, stored as entered, displayed as entered |
| `billingAddress` | `Subdoc` | `line1, line2, city, state, postalCode, country` |
| `shippingAddress` | `Subdoc` | Same shape |
| `ownerId` | `ObjectId` | Member, the accountable person |
| `status` | `String` | `PROSPECT` \| `CUSTOMER` \| `PARTNER` \| `SUPPLIER` \| `INACTIVE` |
| `tags` | `[ObjectId]` | Ref `Tag` |
| `notes` | `String?` | Short summary; the long form lives in activities |
| `customFields` | `Mixed` | Keys validated against `field_definitions` |
| `size` | `Number?` | Headcount |
| `annualRevenue` | `Number?` | Organisation currency |
| `deletedAt` | `Date?` | |

**Indexes**

| Index | Serves |
|---|---|
| `{ organizationId: 1, name: 1 }` | Name sort and prefix search |
| `{ organizationId: 1, status: 1, createdAt: -1 }` | Status filter |
| `{ organizationId: 1, ownerId: 1, updatedAt: -1 }` | "My companies" |
| `{ organizationId: 1, email: 1 }` | Duplicate detection |
| `{ organizationId: 1, name: 'text', industry: 'text' }` | Global search |
| `{ organizationId: 1, tags: 1 }` | Tag filter |

### `contacts`

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | Indexed |
| `firstName` | `String` | 1–80 |
| `lastName` | `String` | 1–80 |
| `salutation`, `jobTitle` | `String?` | |
| `companyId` | `ObjectId?` | Ref `Company`, same tenant |
| `ownerId` | `ObjectId` | Member |
| `primaryEmail` | `String?` | |
| `emails` | `[{ label, value, isPrimary }]` | Multiple addresses |
| `phones` | `[{ label, value, isPrimary }]` | |
| `status` | `String` | `LEAD` \| `PROSPECT` \| `CUSTOMER` \| `INACTIVE` |
| `tags` | `[ObjectId]` | |
| `notes` | `String?` | |
| `customFields` | `Mixed` | |
| `lastContactedAt` | `Date?` | Maintained by the activity service |
| `mergedIntoId` | `ObjectId?` | Set when this contact is merged into another |
| `deletedAt` | `Date?` | |

**Indexes**

| Index | Serves |
|---|---|
| `{ organizationId: 1, lastName: 1, firstName: 1 }` | Default sort and directory listing |
| `{ organizationId: 1, companyId: 1, lastName: 1 }` | Contacts nested under a company |
| `{ organizationId: 1, ownerId: 1, updatedAt: -1 }` | "My contacts" |
| `{ organizationId: 1, status: 1, createdAt: -1 }` | Status filter |
| `{ organizationId: 1, primaryEmail: 1 }` | Duplicate detection |
| `{ organizationId: 1, firstName: 'text', lastName: 'text', primaryEmail: 'text' }` | Global search |

### `leads`

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | Indexed |
| `title` | `String` | e.g. "Website enquiry — Acme" |
| `contactId` | `ObjectId?` | Ref `Contact` |
| `contactSnapshot` | `Subdoc` | `firstName, lastName, email, phone, companyName` — captured at creation so a converted or deleted contact does not erase the lead's origin |
| `companyId` | `ObjectId?` | Ref `Company` |
| `source` | `String` | Free text; seeded from the organisation's configured list |
| `status` | `String` | `NEW` \| `CONTACTED` \| `QUALIFIED` \| `UNQUALIFIED` \| `CONVERTED` |
| `score` | `Number` | 0–100, manual in the MVP |
| `ownerId` | `ObjectId` | Member |
| `notes` | `String?` | |
| `customFields` | `Mixed` | |
| `convertedAt` | `Date?` | |
| `convertedContactId` | `ObjectId?` | |
| `convertedCompanyId` | `ObjectId?` | |
| `convertedDealId` | `ObjectId?` | |
| `deletedAt` | `Date?` | |

**Indexes**

| Index | Serves |
|---|---|
| `{ organizationId: 1, status: 1, createdAt: -1 }` | Pipeline-ish lead list |
| `{ organizationId: 1, ownerId: 1, createdAt: -1 }` | "My leads" |
| `{ organizationId: 1, source: 1, status: 1 }` | Source performance |
| `{ organizationId: 1, convertedAt: 1 }` | Conversion rate |

The `contactSnapshot` subdocument is a deliberate redundancy. It is the reason
lead analytics survives a deleted contact.

### `deals`

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | Indexed |
| `name` | `String` | 1–160 |
| `companyId` | `ObjectId?` | |
| `contactId` | `ObjectId?` | |
| `pipelineId` | `ObjectId` | Ref `Pipeline` |
| `stageId` | `ObjectId` | Must belong to `pipelineId` |
| `ownerId` | `ObjectId` | Member |
| `value` | `Number` | Default 0. Minor units are not used; see note below |
| `currency` | `String` | ISO 4217, defaults to the organisation currency |
| `probability` | `Number` | 0–100 |
| `status` | `String` | `OPEN` \| `WON` \| `LOST` |
| `expectedCloseDate` | `Date?` | |
| `closedAt` | `Date?` | |
| `lostReason` | `String?` | |
| `description` | `String?` | |
| `sortOrder` | `Number` | Position within a Kanban column |
| `tags` | `[ObjectId]` | |
| `customFields` | `Mixed` | |
| `deletedAt` | `Date?` | |

> **Money.** Values are stored as JavaScript numbers in major units, with all
> arithmetic in integer minor units inside the service layer. This is
> acceptable for MVP pipeline estimates. Before the Finance stage it must be
> revisited — see open question C in `DISCOVERY.md` and ADR-0006 when written.
> Getting this wrong is expensive to unwind, so it is a Gate 2 item.

**Indexes**

| Index | Serves |
|---|---|
| `{ organizationId: 1, pipelineId: 1, stageId: 1, sortOrder: 1 }` | Kanban column fetch — the hottest read |
| `{ organizationId: 1, status: 1, expectedCloseDate: 1 }` | Open deals, forecast, overdue |
| `{ organizationId: 1, ownerId: 1, updatedAt: -1 }` | "My deals" |
| `{ organizationId: 1, companyId: 1, createdAt: -1 }` | Company 360 |
| `{ organizationId: 1, closedAt: -1 }` | Win-rate reporting |

### `tags`

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | |
| `name` | `String` | 1–40 |
| `color` | `String` | Token name, not a hex literal |

**Indexes**: `{ organizationId: 1, name: 1 }` unique

A `Tag` collection rather than bare strings, because tags need colours, a picker
and usage counts. Free-text tags would be a data-quality problem within a month.

### `field_definitions`

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | |
| `entityType` | `String` | `CONTACT` \| `COMPANY` \| `LEAD` \| `DEAL` \| `TASK` |
| `key` | `String` | Stable machine key, snake_case |
| `label` | `String` | Display label |
| `type` | `String` | `TEXT` \| `NUMBER` \| `DATE` \| `BOOLEAN` \| `SELECT` \| `MULTI_SELECT` |
| `options` | `[String]` | For select types |
| `required` | `Boolean` | |
| `order` | `Number` | |

**Indexes**: `{ organizationId: 1, entityType: 1, key: 1 }` unique

Custom fields are stored in a `Mixed` map on the entity and validated against
these definitions at the service layer. Custom fields are **never** indexed and
**never** used for authorization — they are presentation and segmentation only.

---

## 5. Pipelines

### `pipelines`

Stages are **embedded**, not a separate collection. They are always read with
their pipeline, never queried independently, always fewer than thirty, and must
be reorderable atomically. Embedding makes a reorder a single update with no
possibility of a partially applied move.

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | |
| `name` | `String` | 1–80 |
| `description` | `String?` | |
| `isDefault` | `Boolean` | At most one per organisation |
| `order` | `Number` | |
| `stages` | `[{ _id, key, name, order, probability, color, isWon, isLost }]` | `_id` is a client-generated `ObjectId` so a deal can reference a stage before the pipeline is saved |
| `deletedAt` | `Date?` | |

**Indexes**: `{ organizationId: 1, name: 1 }` unique ·
`{ organizationId: 1, isDefault: 1 }` (unique partial on `isDefault: true`) ·
`{ organizationId: 1, order: 1 }`

A deal referencing a deleted stage is reassigned to the first remaining stage by
the pipeline service, inside the same operation, and the reassignment is audited.

---

## 6. Activities

### `activities`

The single timeline for everything that happened. One collection, one shape,
many subjects.

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | Indexed |
| `type` | `String` | `NOTE` \| `TASK` \| `CALL` \| `MEETING` \| `SYSTEM_EVENT` \| `STAGE_CHANGE` \| `EMAIL` \| `SMS` \| `WHATSAPP` |
| `title` | `String` | Denormalised for list rendering |
| `body` | `String?` | Plain text. Rendered as text, never as HTML. |
| `direction` | `String?` | `INBOUND` \| `OUTBOUND` — for channels where it applies |
| `durationSeconds` | `Number?` | Calls and meetings |
| `occurredAt` | `Date` | When it happened, not when it was recorded |
| `actorId` | `ObjectId?` | Null for system events |
| `ownerId` | `ObjectId` | Member the activity is attributed to |
| `subjects` | `[{ entityType, entityId }]` | See below |
| `metadata` | `Mixed` | Channel payloads, stage names, automation data |
| `createdAt` | `Date` | Automatic |

`EMAIL`, `SMS` and `WHATSAPP` are declared in the enum from day one and simply
unused. Adding a channel later is a provider adapter, not a migration.

**Indexes**

| Index | Serves |
|---|---|
| `{ organizationId: 1, 'subjects.entityId': 1, occurredAt: -1 }` | The per-record timeline — multikey, the primary read |
| `{ organizationId: 1, occurredAt: -1, _id: -1 }` | The organisation feed |
| `{ organizationId: 1, type: 1, occurredAt: -1 }` | Filter by activity type |
| `{ organizationId: 1, actorId: 1, occurredAt: -1 }` | "My activity" |
| `{ organizationId: 1, ownerId: 1, occurredAt: -1 }` | Attribution reports |

`subjects` is an array because one call legitimately concerns a contact, a
company and a deal at once. Only one array field appears in any compound index,
which is the MongoDB requirement for a valid multikey compound index.

**Known gap.** There is no dedupe key, unlike `notifications`. The in-process bus
delivers an event exactly once to an exactly-once emitter, so nothing is
duplicated today, and adding an undeclared field to the schema on a guess would
be worse than recording the gap. Moving the bus to a real broker (Stage 7) makes
delivery at-least-once and this schema needs an idempotency key at that point,
before the first broker is connected rather than after the first duplicate row
appears in someone's timeline.

> The multikey index on `subjects.entityId` is scoped by the leading
> `organizationId`, so a timeline query can never cross the tenant boundary even
> if the repository guard were removed. The index is the second line of defence
> behind the repository.

---

## 7. Tasks

### `tasks`

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | |
| `title` | `String` | 1–200 |
| `description` | `String?` | |
| `assigneeId` | `ObjectId?` | Member; null means unassigned |
| `createdBy` | `ObjectId` | User |
| `status` | `String` | `TODO` \| `IN_PROGRESS` \| `DONE` \| `CANCELED` |
| `priority` | `String` | `LOW` \| `MEDIUM` \| `HIGH` \| `URGENT` |
| `dueAt` | `Date?` | |
| `completedAt` | `Date?` | |
| `related` | `[{ entityType, entityId }]` | Same shape as `Activity.subjects` |
| `reminders` | `[{ remindAt, sentAt }]` | MVP records the intent; dispatch is Stage 7 |
| `estimatedMinutes` | `Number?` | |
| `deletedAt` | `Date?` | |

**Indexes**

| Index | Serves |
|---|---|
| `{ organizationId: 1, assigneeId: 1, status: 1, dueAt: 1 }` | "My open tasks", overdue detection |
| `{ organizationId: 1, status: 1, dueAt: 1 }` | Team task board |
| `{ organizationId: 1, 'related.entityId': 1 }` | Tasks on a record page |
| `{ organizationId: 1, createdBy: 1, createdAt: -1 }` | "Created by me" |

---

## 8. Notifications and audit

### `notifications`

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | |
| `userId` | `ObjectId` | Recipient |
| `type` | `String` | `TASK_ASSIGNED`, `MENTION`, `DEAL_ASSIGNED`, `TASK_OVERDUE`, `SYSTEM` |
| `channel` | `String` | `IN_APP` \| `EMAIL` \| `SMS` \| `PUSH` \| `WHATSAPP` |
| `title`, `body` | `String` | |
| `data` | `Mixed` | Deep link, entity references |
| `dedupeKey` | `String?` | Idempotency — a repeated event does not duplicate |
| `readAt` | `Date?` | |

**Indexes**

| Index | Serves |
|---|---|
| `{ organizationId: 1, userId: 1, readAt: 1, createdAt: -1 }` | Bell, unread count |
| `{ organizationId: 1, userId: 1, dedupeKey: 1 }` | Partial unique — idempotency |

`channel` exists from the start so Stage 5 adds provider delivery without
touching the read path. The MVP writes `IN_APP` only.

The idempotency index is **partial**, not sparse. A sparse index skips documents
that are missing the field, and a `dedupeKey` of `null` is present rather than
missing, so with a null default every undeduped notification for a user would
collide with every other one and the second send would be silently swallowed.
`dedupeKey` therefore has no default, and the index carries
`partialFilterExpression: { dedupeKey: { $type: "string" } }`.

Asking for a channel with no implementation **throws** rather than storing the
row and skipping delivery. The caller would otherwise believe an email reached
a customer while it sat unread in a bell nobody was watching, and the failure
would surface days later as a support ticket instead of at the call site. The
error is `CONFIGURATION_INVALID`, unexposed.

### `audit_logs`

Append-only. There is no update or delete path in any service.

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | |
| `actorId` | `ObjectId?` | Null for system actions |
| `actorName` | `String` | Denormalised, so the log survives user deletion |
| `action` | `String` | `contact.create`, `deal.stage_change`, `settings.update` |
| `entityType` | `String` | |
| `entityId` | `ObjectId?` | |
| `entityLabel` | `String?` | Human-readable at the time of the action |
| `changes` | `{ before: Mixed, after: Mixed }` | Only changed fields |
| `metadata` | `Mixed` | |
| `ip`, `userAgent` | `String?` | |
| `createdAt` | `Date` | |

**Indexes**

| Index | Serves |
|---|---|
| `{ organizationId: 1, createdAt: -1 }` | The audit screen |
| `{ organizationId: 1, entityType: 1, entityId: 1, createdAt: -1 }` | "History of this record" |
| `{ organizationId: 1, actorId: 1, createdAt: -1 }` | "What did this user do" |

Two independent things keep secrets out of `changes`, and neither is sufficient
alone:

- **The caller passes a projection that excludes `select: false` fields.** Only
  the caller can know which fields those are; the service cannot infer it from
  the schema, and a `select: false` field is usually exactly the sensitive one.
- **`recordAction` redacts by key name before the write** — `password`,
  `passwordHash`, `token`, `authorization`, and the rest, shared with the
  request logger so the two cannot drift.

The diff is *not* computed from an allow-list of fields. An allow-list has to be
maintained alongside every call site, and a field changed but not listed is a
change the audit log does not know about — the failure mode this collection
exists to prevent. Redaction removes known secrets without also deciding which
changes were worth recording. The cost is the mirror image: a secret under a
name the redactor does not recognise would be written, which is why the
projection above is a requirement on callers rather than a suggestion.

`changes` is stored as one `Mixed` value rather than a nested subdocument,
because mongoose gives a subdocument its own `_id` and a meaningless id inside
every diff is weight every consumer would have to learn to ignore.

### `auth_events`

Global and tenant-free. See
[ADR-0006](./decisions/0006-global-authentication-event-log.md). Append-only,
and carrying no `organizationId` field of any kind — not a nullable one — so a
cross-tenant read is not merely guarded against but unexpressible.

| Field | Type | Notes |
|---|---|---|
| `userId` | `ObjectId?` | Null when the address has no account |
| `email` | `String` | Denormalised, so the row still reads after the user is deleted. Bounded |
| `action` | `String` | Server-side enum: `auth.login`, `auth.login_failed`, `auth.lockout`, `auth.logout`, `auth.logout_all`, `auth.register`, `auth.password_reset_requested`, `auth.password_reset_completed` |
| `outcome` | `String` | `success` \| `failure`, always present |
| `ip`, `userAgent` | `String?` | Truncated in the schema setter, as on `sessions` |
| `createdAt` | `Date` | Automatic. No `updatedAt` |

There is no `changes` and no `metadata`. That absence is load-bearing rather than
incidental: a `Mixed` field accepts a caller-supplied shape, a shape can violate
a server-side constraint, and this collection's write is permitted to fail
without failing the request that produced it — so a constraint a caller can trip
is a request that can be turned into a 500 by the log.
`tests/unit/architecture/auth-event.test.ts` asserts the absence.

**Indexes**

| Index | Serves |
|---|---|
| `{ userId: 1, createdAt: -1 }` | The account owner's "your sign-in history" |
| `{ createdAt: 1 }` TTL `expireAfterSeconds: 7776000` | 90-day retention — **serves no query; see below** |

Any further index is added in the same commit as the query that needs it, per §1.

**The TTL index is a named exception to §1's rule.** Every other index in this
document names the query it serves, and this one names none: it exists to delete.
It is the first index in the repository to break that rule, and the first TTL
that deletes a *live* record. All four existing TTLs — `sessions`,
`password_reset_tokens`, `email_verification_tokens`, `invitations` — remove rows
already dead by their own `expiresAt`, which is the reasoning recorded at
`src/modules/identity/session.model.ts:81-82`: cleanup is the database's job, so
there is no cron and no cron to forget to run.

`auth_events` rows are not dead when they expire. Deleting them is a decision
about what to stop being able to prove, and it is the reason a shorter window is
deliberate rather than accidental. Naming the exception is what keeps the next
person applying §1 mechanically from removing it.

The period is `AUTH_EVENT_TTL_DAYS`, exported beside `SESSION_TTL_DAYS`,
`PASSWORD_RESET_TTL_MINUTES`, `EMAIL_VERIFICATION_TTL_HOURS` and
`INVITATION_TTL_DAYS`. It is deliberately not an environment variable: a
retention period configuration can change is one nobody has decided. Two
consequences worth stating. An investigator querying the raw collection still gets
an empty result for an expired row, indistinguishable from an event that never
happened — MongoDB's TTL monitor emits nothing — so the account-owner read surface
states the retention period and never presents "nothing before date X" as "you
never signed in before date X". And a 30-day session TTL means a stale session row
can outlive the event that explains it.

---

## 9. Saved views

### `saved_views`

| Field | Type | Notes |
|---|---|---|
| `organizationId` | `ObjectId` | |
| `userId` | `ObjectId` | Views are personal |
| `entityType` | `String` | `CONTACT` \| `COMPANY` \| `LEAD` \| `DEAL` \| `TASK` |
| `name` | `String` | 1–60 |
| `filters` | `Mixed` | Validated against the entity's list-query schema at write time, so a saved view can never contain an unsafe filter |
| `sort` | `String` | |
| `columns` | `[String]` | Visible, order, width |
| `isShared` | `Boolean` | Default false |

**Indexes**: `{ organizationId: 1, userId: 1, entityType: 1, name: 1 }` unique

Filters are stored as validated data, never as a raw query string. This is both a
safety property and the reason `NoSQL injection` cannot reach a saved view.

---

## 10. Cross-collection integrity

MongoDB has no foreign keys. Three mechanisms compensate, and all three are
required — none is sufficient alone.

1. **Application-level validation.** A service that writes `membership.roleId`
   loads the role and asserts `role.organizationId === membership.organizationId`
   before writing. Same for `deal.stageId` against `deal.pipelineId`, and
   `contact.companyId`.
2. **Transaction for multi-document invariants.** Lead conversion writes a
   contact, possibly a company, possibly a deal, and updates the lead. That is a
   transaction, so a failure half-way cannot leave a half-converted lead.
   Requires a replica set — Atlas provides it; local development must use a
   single-node replica set.
3. **Reconciliation job.** A scheduled maintenance pass finds orphaned
   references and reports them. This is a safety net, not a substitute for 1
   and 2, and is deferred until there is enough data for it to mean something.

**Deletion policy.** Deleting a record that others reference is a soft delete.
Hard deletion is reserved for records with no dependents: `Tag`,
`field_definitions`, and expired tokens (by TTL).

---

## 11. Connection and environment

```ts
// Development:  mongodb://127.0.0.1:27017/biz_nexus
// Production:   Atlas SRV, with the Node driver pool sized for serverless
```

Serverless-safe connection, cached on `globalThis` so a warm instance reuses one
client:

```ts
const maxPoolSize = 5;          // Vercel: few concurrent requests per instance
const serverSelectionTimeoutMS = 5000;
const bufferCommands = false;   // fail fast instead of buffering into a timeout
```

`bufferCommands: false` matters on serverless: a cold or slow database must
surface as an error the user can see, not a request that hangs until the function
times out.

See the `mongodb-connection` skill for the full pattern, and
[ADR-0001](./decisions/0001-mongodb-and-mongoose.md) for the decision itself.
