# Master Implementation Plan

> This is **the** plan file. Every unit of work below is one commit.
> Phase 0 is complete. Phase 1 begins on approval. Phases 2+ are gated.

See also: [`DISCOVERY.md`](./DISCOVERY.md) · [`PRODUCT.md`](./PRODUCT.md) ·
[`ROADMAP.md`](./ROADMAP.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) ·
[`DATABASE.md`](./DATABASE.md) · [`SECURITY.md`](./SECURITY.md) ·
[`API.md`](./API.md) · [`decisions/`](./decisions)

---

## Working agreement

Each numbered task is one commit, and a commit is only made once the task
actually passes: `npm run lint`, `npm run typecheck`, and the tests it adds all
green. A commit that breaks the build is a failed step, not progress.

Commits follow Conventional Commits. Scopes in this repository:
`auth`, `org`, `rbac`, `db`, `crm`, `pipelines`, `activities`, `tasks`,
`notify`, `audit`, `api`, `ui`, `test`, `docs`, `ci`, `chore`, `deps`.

---

# Phase 0 — Discovery — COMPLETE

| # | Task | Commit | Status |
|---|---|---|---|
| 0.1 | Read bundled Next 16 docs; record breaking changes | `docs: record next 16 breaking changes` | done |
| 0.2 | Audit environment and sibling-project conventions | `docs: record phase 0 discovery assessment` | done |
| 0.3 | Audit available skills; install the five gaps | *(global, outside repo)* | done |
| 0.4 | Product definition and MVP boundary | `docs: define product scope and mvp boundary` | done |
| 0.5 | Architecture, data model, security, API contract | `docs: define architecture data model and api contract` | done |
| 0.6 | Record architectural decisions | `docs: record architectural decisions` | done |
| 0.7 | Environment template, scripts, docs index, README | `chore: add environment template and project scripts` | done |

**Exit criteria for Phase 0:** repository understood, stack decided, product
scope agreed, architecture documented, open questions listed. — met.

---

# Phase 1 — MVP Foundation

Goal: a signed-in user can create an organisation, invite a colleague, and the
system is provably incapable of leaking data across organisation boundaries.

## 1A — Foundations

| # | Task | Commit | Done when |
|---|---|---|---|
| 1.1 | Install runtime deps: `mongoose`, `zod`, `bcryptjs`, `jose`, `sonner`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, `react-hook-form`, `@hookform/resolvers`, `next-themes` | `chore(deps): add mvp runtime dependencies` | `npm run typecheck` passes |
| 1.2 | Install dev deps: `vitest`, `@vitest/coverage-v8`, `mongodb-memory-server`, `@playwright/test`, `dotenv-cli` | `chore(deps): add test tooling` | `npx vitest --version` succeeds |
| 1.3 | Add scripts: `typecheck`, `test`, `test:watch`, `test:coverage`, `test:e2e`, `validate` | `chore: add project scripts` | `npm run validate` runs the chain |
| 1.4 | Design tokens + base layer in `globals.css` (colour, type scale, radius, shadow, motion) | `feat(ui): establish design tokens` | tokens render with no Tailwind errors |
| 1.5 | Base UI primitives: `Button`, `Input`, `Label`, `Field`, `Card`, `Badge`, `Dialog`, `DropdownMenu`, `Select`, `Textarea`, `Skeleton`, `EmptyState`, `Table` | `feat(ui): add base ui component primitives` | all render in a `/dev/ui` scratch route |
| 1.6 | `cn()` utility, formatters (date, currency, relative time, initials) | `feat(shared): add formatting and class utilities` | unit tests green |
| 1.7 | Environment module: parse and validate `process.env` once, fail loudly at boot | `feat(shared): add typed environment module` | missing var throws at startup |

## 1B — Database and tenancy

| # | Task | Commit | Done when |
|---|---|---|---|
| 1.8 | Serverless-safe Mongoose connection: cached on `globalThis`, small pool, retry, `serverSelectionTimeoutMS` | `feat(db): add serverless-safe mongoose connection` | two concurrent requests open one connection |
| 1.9 | `TenantRepository` base class — every query, update and delete is forced through an `organizationId` filter that cannot be omitted | `feat(db): add tenant scoped repository base` | omitting the org filter is impossible without a deliberate escape hatch |
| 1.10 | Base model mixins: `SoftDelete`, `AuditFields` (`createdBy`, `updatedBy`), `Slug` | `feat(db): add shared model mixins` | unit tests green |
| 1.11 | Schemas: `User`, `Session`, `PasswordResetToken` | `feat(db): add identity schemas` | collection validators pass |
| 1.12 | Schemas: `Organization`, `Membership`, `Role`, `Invitation` | `feat(db): add organization and rbac schemas` | compound unique indexes present |
| 1.13 | Permission catalogue: code-level `const` map + derived union type | `feat(rbac): define permission catalogue` | every permission is `<domain>.<action>` |
| 1.14 | Auth service: password hashing, session issue/verify/revoke, expiry | `feat(auth): add session and password services` | unit tests green |
| 1.15 | Data Access Layer: `getSession()`, `requireUser()`, `requireOrg()`, `requirePermission()` | `feat(auth): add data access layer with permission guards` | guard tests green |
| 1.16 | `src/proxy.ts` — optimistic cookie check and redirect only, no DB access | `feat(auth): add proxy for optimistic session checks` | unauthenticated hit on a protected page redirects |
| 1.17 | Tenant-isolation test suite — the cross-tenant matrix | `test(auth): prove cross tenant isolation fails` | every case returns 404/403, never data |

## 1C — RBAC

| # | Task | Commit | Done when |
|---|---|---|---|
| 1.18 | Role service: provision OWNER/ADMIN/MEMBER/VIEWER on organisation creation | `feat(rbac): add system role provisioning` | new org has exactly four roles |
| 1.19 | Permission matrix per system role | `feat(rbac): define system role permission matrix` | Viewer cannot write; Member cannot manage members |
| 1.20 | Membership + invitation service (token hash, expiry, single-use, resend) | `feat(org): add membership and invitation services` | expired and reused tokens rejected |
| 1.21 | Authorization test suite — every permission × every endpoint | `test(rbac): cover permission matrix` | 403 for each missing permission |

## 1D — Shared application services

| # | Task | Commit | Done when |
|---|---|---|---|
| 1.22 | Error taxonomy (`AppError` + codes) and the `ok`/`fail` response envelopes | `feat(shared): add error taxonomy and response envelopes` | contract tests green |
| 1.23 | `withApi()` route-handler HOF: request id, error mapping, safe logging, `unstable_rethrow` | `feat(api): add route handler wrapper` | an unexpected error returns 500 with no internals leaked |
| 1.24 | List query primitives: pagination, sorting, search, filter parsing from one Zod schema | `feat(shared): add list query primitives` | unit tests green |
| 1.25 | Domain event bus: typed `emit`/`subscribe`, in-process, non-durable, error-isolated | `feat(events): add in process domain event bus` | a throwing subscriber cannot break the emitter |
| 1.26 | Audit service: `recordAction()` with before/after diff | `feat(audit): add audit log service` | stage changes and settings edits recorded |
| 1.27 | Notification service + abstraction (`IN_APP` now; EMAIL/SMS/PUSH/WHATSAPP later) | `feat(notify): add notification service` | notifications land in the bell |
| 1.28 | Activity service + abstraction, subscribes to domain events | `feat(activities): add activity timeline service` | deal stage change writes a `STAGE_CHANGE` activity |

## 1E — Auth UI and API

| # | Task | Commit | Done when |
|---|---|---|---|
| 1.29 | Auth API: `POST /register`, `/login`, `/logout`, `/forgot-password`, `/reset-password`, `/verify-email`; `GET /me` | `feat(auth): add versioned auth endpoints` | contract tests green |
| 1.30 | Global append-only authentication event log: `auth.login`, `auth.login_failed`, `auth.lockout`, `auth.logout`, `auth.logout_all`, `auth.register`, `auth.password_reset_requested`, `auth.password_reset_completed` | `feat(audit): add global authentication event log` | every 1.29 auth event is recorded, and no read or write of it requires an `organizationId` |
| 1.31 | Rate limiting on auth endpoints, with a serverless-safe driver interface | `feat(auth): rate limit auth endpoints` | lockout after N failures; limits sized against the measured `bcryptjs` cost, not the documented 250ms |
| 1.32 | Auth pages: sign in, register, forgot, reset, with inline validation and accessible errors | `feat(auth): add authentication pages` | keyboard-navigable, errors announced; the sign-in activity view reads the 1.30 log, so this cannot land before it |
| 1.33 | Password-reset mailer abstraction with a `console` development driver | `feat(auth): add mailer abstraction` | reset link printed in dev, never in prod logs |

## 1F — Organisation and members

| # | Task | Commit | Done when |
|---|---|---|---|
| 1.34 | Onboarding: create organisation, first-run checklist | `feat(org): add organization onboarding` | first org usable end to end |
| 1.35 | Organisation switcher, persisted to the session | `feat(org): add organization switching` | switching changes every query's scope |
| 1.36 | Members API: list, invite, update role, suspend, remove, leave | `feat(org): add member management endpoints` | contract tests green |
| 1.37 | Members UI: directory, invite dialog, role management | `feat(org): add member management screens` | owner can invite and assign a role |
| 1.38 | Organisation settings UI | `feat(org): add organization settings screens` | settings changes audited |

## 1G — CRM

| # | Task | Commit | Done when |
|---|---|---|---|
| 1.39 | Tag collection + service | `feat(crm): add tag model and service` | unique per organisation |
| 1.40 | Field-definition collection + service (custom fields) | `feat(crm): add custom field definitions` | definitions validated per entity type |
| 1.41 | Saved-view collection + service | `feat(crm): add saved views` | views are per user per entity |
| 1.42 | Contact schema + repository + service | `feat(crm): add contacts` | search, filter, sort, paginate, soft delete |
| 1.43 | Contacts API | `feat(crm): add contact endpoints` | contract tests green |
| 1.44 | Contacts UI: list, filters, form drawer, detail, merge-later placeholder | `feat(crm): add contact screens` | full CRUD from the UI |
| 1.45 | Company schema + repository + service | `feat(crm): add companies` | contacts nested under company |
| 1.46 | Companies API | `feat(crm): add company endpoints` | contract tests green |
| 1.47 | Companies UI | `feat(crm): add company screens` | full CRUD from the UI |
| 1.48 | Lead schema + repository + service | `feat(crm): add leads` | status transitions validated |
| 1.49 | Lead conversion service — Contact + optional Company + optional Deal, in one audited operation | `feat(crm): add lead conversion` | conversion is atomic and idempotent |
| 1.50 | Leads API | `feat(crm): add lead endpoints` | contract tests green |
| 1.51 | Leads UI, including the conversion dialog | `feat(crm): add lead screens` | conversion works from the UI |

## 1H — Pipelines and deals

| # | Task | Commit | Done when |
|---|---|---|---|
| 1.52 | Pipeline schema (stages embedded) + service + default provisioning | `feat(pipelines): add pipeline and stage management` | new org gets a working default pipeline |
| 1.53 | Pipelines API + UI (list, create, rename, reorder stages) | `feat(pipelines): add pipeline screens and endpoints` | reorder is atomic |
| 1.54 | Deal schema + repository + service | `feat(crm): add deals` | value, probability, expected close |
| 1.55 | Deal stage-move service with a STAGE_CHANGE activity and audit entry | `feat(crm): add deal stage transitions` | every move is attributed |
| 1.56 | Deals API | `feat(crm): add deal endpoints` | contract tests green |
| 1.57 | Deals UI: list, filters, and drag-and-drop Kanban | `feat(crm): add deal list and kanban board` | a move is reflected in the timeline |
| 1.58 | Deal detail page with the unified activity timeline | `feat(crm): add deal detail view` | timeline renders in order |

## 1I — Activities and tasks

| # | Task | Commit | Done when |
|---|---|---|---|
| 1.59 | Task schema + repository + service | `feat(tasks): add task management` | assignment, due date, priority, status |
| 1.60 | Tasks API | `feat(tasks): add task endpoints` | contract tests green |
| 1.61 | Tasks UI: list, board-by-status, form, complete | `feat(tasks): add task screens` | completion writes an activity |
| 1.62 | Activity API: list by entity, list by organisation, create note/call/meeting | `feat(activities): add activity endpoints` | chronological, paginated |
| 1.63 | Activity composer + timeline component, reusable on every record page | `feat(activities): add activity timeline component` | one component, used in four places |
| 1.64 | Organisation-wide activity feed | `feat(activities): add organization activity feed` | respects permission and tenant scope |

## 1J — Notifications, dashboard, polish

| # | Task | Commit | Done when |
|---|---|---|---|
| 1.65 | Notifications API + bell menu + unread count + mark read | `feat(notify): add notification screens` | unread count accurate after a task is assigned |
| 1.66 | Dashboard API: all MVP metrics in one round trip | `feat(dashboard): add metrics endpoint` | no N+1 |
| 1.67 | Dashboard UI: metric cards, pipeline summary, overdue tasks, recent activity | `feat(dashboard): add dashboard screens` | loads with skeletons, then data |
| 1.68 | Audit log API + admin UI | `feat(audit): add audit log screens` | org-scoped, filterable |
| 1.69 | Global search across contacts, companies, deals, tasks | `feat(ui): add global search` | scoped to the active organisation |
| 1.70 | App shell: sidebar, header, command palette, breadcrumbs, responsive nav | `feat(ui): build authenticated app shell` | works at 375px and 1440px |
| 1.71 | Error, loading, empty, not-found and forbidden boundaries | `feat(ui): add route boundaries and states` | every route has all four |
| 1.72 | Accessibility pass: focus rings, labels, landmarks, contrast, keyboard traps | `test(ui): cover keyboard and screen reader basics` | no violation in a manual audit |

## 1K — Verification and hardening

| # | Task | Commit | Done when |
|---|---|---|---|
| 1.73 | Playwright e2e for the critical path | `test(e2e): cover mvp critical path` | the full flow passes from a clean database |
| 1.74 | Playwright e2e for the isolation path | `test(e2e): prove cross tenant access is denied` | organisation A cannot reach B by URL or API |
| 1.75 | Security review against `docs/SECURITY.md` | `fix(security): remediate phase 1 security findings` | no open high or critical finding |
| 1.76 | CI: lint, typecheck, unit, integration, build | `ci: add continuous integration workflow` | green on a clean checkout |
| 1.77 | Update documentation to match reality | `docs: update documentation for mvp completion` | docs describe what exists, not what was planned |
| 1.78 | Evaluate a native bcrypt binding (`bcrypt`/`argon2`) against `bcryptjs`, cost 12 held constant | `deps(auth): evaluate native password hashing binding` | the choice is measured on this codebase, and the ~250ms figure in `SECURITY.md`/`DATABASE.md` is corrected to whatever was actually observed |

**The cost factor is not part of 1.78.** `docs/SECURITY.md` §2 and
`docs/DATABASE.md` §2 pin bcrypt at cost 12, and that pin is a correctness
decision: it is the number that makes an offline attack expensive, and it is
revisited only by a decision to change it, not by a decision to make hashing
faster. What 1.78 evaluates is the *implementation* — `bcryptjs` is pure
JavaScript and measures roughly **1.8s per hash / 1.9s per verify** on an i5-7200U,
against the ~250ms the documentation previously described for a native bcrypt on
modern server CPU. That is not a security finding; it is a **>7x discrepancy**
between what the docs said a sign-in costs and what it costs, and it has a
consequence that is a security concern: 1.31 sizes a rate limiter, and a limiter
configured against 250ms on a machine that spends 1.8s hashing does not bound
the attack it exists to bound.

**Exit criteria (Gate 1):**

```
[ ] Critical path passes end to end from a clean database
[ ] Isolation path fails closed for every route, by URL and by API
[ ] Every endpoint covered by a permission test
[ ] No open high or critical security finding
[ ] CI green
[ ] Every feature meets the ten-part definition of done
[ ] Documentation matches the code
```

**Gate 1 is not passed by compiling. It is passed by the evidence above.**

---

# Phase 2 and beyond — gated, not planned in detail

Each stage below is a separate planning exercise, executed only after its gate
passes. See [`ROADMAP.md`](./ROADMAP.md) for the stage list and gate conditions.

| Stage | Theme | Gate to enter |
|---|---|---|
| 2 | Sales — products, services, quotations, sales orders | Gate 1 |
| 3 | Finance — invoices, payments, expenses, receivables, payables | Gate 2 |
| 4 | Inventory and procurement | Gate 3 |
| 5 | Communication — internal messages, provider abstractions | Gate 4 |
| 6 | Unified inbox | Gate 5 |
| 7 | Automation and workflows | Gate 6 |
| 8 | Business playbooks | Gate 7 |
| 9 | Reporting and analytics | — |
| 10 | Documents and files | — |
| 11 | Integrations and public API keys | — |
| 12 | SaaS billing | — |
| 13 | AI assistance | Gate 7 |

## Working method for every stage

```
1. Understand   read the relevant docs and the existing code
2. Inspect      state the current system before changing it
3. Plan         consult the specialist subagents, write the stage plan
4. Ask          resolve decisions that materially affect data or security
5. Implement    one commit per task, tests included
6. Test         unit, integration, authorization, e2e
7. Review       security review, then a UX review
8. Fix          remediate findings before proceeding
9. Document     update the affected documents in the same commit as the change
10. Commit      Conventional Commits, one logical change each
11. Report      what changed, what was verified, what remains
12. Stop        wait for approval before the next stage
```

## Standing rules

- No stage begins without the previous gate passing.
- No feature ships without tests and documentation.
- No architectural change is made without a new ADR in `docs/decisions/`.
- No commit contains unrelated changes.
- The organisation boundary is the highest-priority invariant. When in doubt,
  the design that makes a cross-tenant leak *impossible* beats the design that
  makes it *unlikely*.
