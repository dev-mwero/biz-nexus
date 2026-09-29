# Product Definition

> Status: agreed for the MVP. Later stages are intentions, not commitments.

---

## 1. What this product is

A **multi-tenant Business Operating System** for small and medium-sized B2B
organisations. CRM is the first domain shipped, but the architecture is a modular
business platform, not a CRM with extra screens.

The CRM is the *relationship layer*. Sales, Finance, Inventory, Communication,
Automation, Reporting and AI are additional layers built on the same
organisation, permission, activity and audit substrate.

## 2. Who it is for

**Generic B2B SMEs.** No vertical is assumed. A dental practice, a design studio
and a wholesale distributor are all first-class users.

Consequences of that choice, applied throughout:

- Nothing is hard-coded to a specific industry. Lead sources, pipeline stages,
  currencies, roles and tags are all organisation-configurable.
- Terminology stays neutral. "Company" not "Account". "Contact" not "Prospect".
- Custom fields are first-class rather than an afterthought, so a vertical can
  be accommodated without a schema change.
- The product must be usable by a two-person company on day one and by a
  fifty-person one later, without forcing the small customer to configure
  anything: a new organisation receives a sensible default pipeline, default
  roles and default lead sources.

## 3. Tenancy model

| Rule | MVP behaviour |
|---|---|
| A user may belong to many organisations | Supported, with an organisation switcher |
| An organisation has many members | Supported, each with exactly one role |
| A member's role is per-organisation | The same person may be Owner in one org and Viewer in another |
| Data isolation | Strict, at the organisation level, on every read and write |
| Branches / teams | **Out of scope.** The schema is designed so they can be added as a scoping dimension without rewriting existing collections. |

The active organisation is derived from the authenticated session. It is never
read from a request body, a query parameter, or a path segment.

## 4. Core concepts

| Concept | Meaning |
|---|---|
| **Organisation** | The tenant. Owns all data, all members, all configuration. |
| **Member** | A user's relationship to an organisation: `{ user, role, status }`. |
| **Role** | A named bundle of permissions, owned by one organisation. |
| **Permission** | A string code such as `deals.update`. Defined in code, never in the database. |
| **Contact** | A person. Belongs to at most one company. |
| **Company** | An organisation that is not our customer-facing tenant — i.e. a prospect or a client. |
| **Lead** | An unqualified enquiry. Converts into a Contact + optional Company + optional Deal. |
| **Deal** | A revenue opportunity moving through a pipeline. |
| **Pipeline / Stage** | A configurable, organisation-owned sequence of deal stages. |
| **Activity** | A timestamped, typed event on the timeline: note, call, meeting, task, or system event. |
| **Task** | An assignable unit of work with a due date, optionally related to a CRM record. |
| **Notification** | An in-app message addressed to one member. |
| **Audit log** | An immutable record of a consequential action. |

### Lead and Contact are separate

A lead is a *marketing/sales* concept; a contact is a *relationship* concept.
Collapsing them loses the ability to hold unqualified enquiries, to measure
conversion, and to re-contact someone who never converted. They are separate
collections, and `Lead.convert` is the explicit bridge between them.

### Company and Contact are one-to-many

A contact belongs to at most one company. The reverse (one company, many
contacts) is the common case and is indexed. A contact may also be standalone
with no company, which is normal for sole traders and individuals.

## 5. MVP scope

The MVP answers exactly one question:

> Can a small organisation run its people, customers, leads, deals, activities
> and tasks through this system, safely, without needing to hire an
> administrator?

### In scope

**Identity and access**
Registration, login, logout, password reset, session management, profile
management, protected routes, account lockout on repeated failures.

**Tenancy and access control**
Organisation creation, organisation switching, member invitation, role
assignment, four system roles (Owner, Admin, Member, Viewer), full permission
catalogue, guards on every data access path.

**CRM**
Contacts, companies, leads (with conversion), deals, tags, notes, custom
fields, owner assignment, search, filtering, sorting, pagination, saved views.

**Sales structure**
Configurable pipelines and stages, deal Kanban, deal list, stage-change
history, default pipeline provisioned for new organisations.

**Activities**
Unified timeline with note, task, call, meeting and system-event types;
attachment to any CRM record; chronological per-record and per-org feeds.

**Tasks**
Create, assign, prioritise, schedule, complete; related to CRM records; overdue
detection surfaced on the dashboard.

**Dashboard**
Contacts, companies, open deals, pipeline value, won, lost, open tasks, overdue
tasks, recent activity.

**Platform**
Versioned REST API, in-app notifications, audit log, activity and audit event
bus, consistent response and error envelopes.

### Definition of done for the MVP

Every feature must ship with all ten of: UI, API, database schema, input
validation, authorization, error handling, loading states, empty states, tests,
documentation. A page that renders is not a finished feature.

### Critical path that must pass end to end

```
Register → Create organisation → Invite member → Assign role
→ Create company → Create contact → Create lead → Convert lead
→ Create deal → Move deal through pipeline → Create task
→ Log activity → Complete task → View dashboard
```

And the security path that must fail:

```
Organisation A can never read, write, or infer the existence of
any record belonging to Organisation B — by any route, at any
permission level, including the owner of both organisations.
```

---

## 6. Explicitly out of MVP scope

Listed so it is clear these are decisions, not omissions.

| Deferred | Why not now |
|---|---|
| Full accounting / bookkeeping | A different product. Needs its own design (see Stage 3). |
| Inventory, warehouses, stock movements | Not required to prove the CRM works. |
| Procurement and suppliers | Follows inventory. |
| WhatsApp, SMS, omnichannel inbox | Requires provider contracts, delivery receipts, and cost modelling. |
| Workflow / automation builder | Core entities must be stable before rules can be written against them. |
| Playbooks | Built on the automation engine, not before it. |
| AI assistant | Requires reliable structured data and trustworthy permissions first. |
| Advanced BI and custom report builder | Dashboard metrics cover the MVP need. |
| SaaS billing and subscriptions | Not needed to validate product-market fit. |
| Third-party integrations and public API keys | No consumer yet. |
| File uploads and documents | Storage, scanning and access control are their own project. |
| Teams, branches, hierarchical orgs | Not requested; schema keeps room. |
| MFA, SSO, SCIM | Enterprise-tier features. Post-MVP. |
| Offline mode, native mobile | Out of scope. |

## 7. Non-negotiable product principles

1. **The organisation boundary is absolute.** A bug here is a security
   incident, not a defect.
2. **Permission checks are never optional.** There is no "internal" endpoint
   that skips authorization because it is only linked from the app.
3. **Configuration over hard-coding.** Stages, roles, sources and fields are
   data. Code ships the mechanism, never the specific value.
4. **Every consequential action is attributable.** Who, what, when, which
   organisation, which record.
5. **Errors are honest.** No silent failures, no swallowed errors, no success
   responses for operations that did not happen.
6. **Delete is reversible where the domain allows it.** Records are archived
   (soft-deleted) so that audit history and timeline integrity survive.
7. **Simple, working, tested, extensible** — in that order, always ahead of
   complex, incomplete, and hard to maintain.

## 8. Terminology

| Term | Meaning in this product | Avoid |
|---|---|---|
| Organisation | The tenant account | Account, workspace, tenant (use in code only) |
| Member | A user inside an organisation | Employee, teammate (UI may use "team") |
| Company | A prospect or client organisation | Account, organisation (reserved for tenants) |
| Contact | A person at a company | Lead (reserved for unqualified enquiries) |
| Lead | An unqualified enquiry | Contact |
| Deal | A revenue opportunity | Opportunity, ticket |
| Stage | A position in a pipeline | Phase, status |
| Activity | A timeline entry | Event (reserved for the internal event bus) |
