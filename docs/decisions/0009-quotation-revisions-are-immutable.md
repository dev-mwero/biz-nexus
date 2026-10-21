# ADR-0009 — A sent quotation is an immutable revision

- **Status:** accepted
- **Date:** 2026-10-19
- **Affects:** `src/modules/quotations`, `src/modules/sales-orders`,
  `docs/API.md`, `docs/DATABASE.md`, the quotation UI

## Context

A quotation is a document a customer receives. Once it has been sent, the
numbers and terms on it are a record of what was offered. Editing that record
afterwards is not an edit; it is a rewrite of history. The product must be able
to answer "what exactly did we send, and when?" even after the price list, the
customer's name, or the deal has changed.

At the same time, a draft must be freely editable. Salespeople revise quotes
constantly before they go out, and after a customer asks for a change. The
system needs both: an editable working document and an immutable sent record,
without duplicating the whole quotation model.

## Options considered

**A. One mutable quotation document with an embedded history array.**
Rejected. The document grows without bound, every read loads history it does
not need, and the current content and the history share one update path. A
single `$set` on the wrong field rewrites a sent revision and no index or
schema can tell you it happened.

**B. One mutable document, with "immutable" enforced by the service.** Rejected.
The service is the right place for the rule, but with no separate row there is
nothing to compare against and nothing to keep. A bug in one code path silently
changes the record. There is no structural backstop.

**C. Separate `quotation_revisions` rows, with the quotation as a parent
identity and lifecycle pointer.** **Chosen.** A revision is written once and
then only its lifecycle timestamps/status change. Sent content is a row that
the update paths do not touch. The parent carries the current pointer, the
status used by lists, and the conversion link.

**D. A separate quotation per revision.** Rejected: the customer-facing number
would change or need a second numbering scheme, and "the history of this quote"
becomes a query across unrelated parents.

## Decision

### Two collections

`quotations` is the identity and lifecycle record: number, company/contact/deal,
owner, currency, validity date, parent status, current revision pointer, the
accepted revision pointer, the order pointer, and denormalised totals for lists.

`quotation_revisions` is the business content: line items, totals, terms, notes,
customer snapshot, validity date, and the revision's own status and lifecycle
timestamps. Revisions are never soft-deleted.

### The immutability rule

A revision is editable only while its status is `DRAFT`. Once it leaves
`DRAFT`:

- line items, prices, quantities, tax rates, totals, terms, notes, customer
  snapshot, and validity date are frozen;
- only lifecycle fields may change: `status`, `sentAt`, `acceptedAt`,
  `rejectedAt`, `supersededAt`, `voidedAt`;
- the repository update filter includes the expected state (for example
  `status: "DRAFT"`), so a zero-match update becomes `409 INVALID_STATE`.

The service checks the state as well. Two checks, because the service check is
readable and the filter check is the structural one.

### The parent mirrors the current revision

The parent carries `status`, `validUntil`, `currentRevisionId`,
`currentRevisionNumber`, and the totals. This is deliberate denormalisation: a
quotation list must filter and sort without joining every current revision.

The cost is an invariant that two rows must agree. Only the quotation service
writes either row, always in one transaction, and the test suite asserts:

1. Parent status mirrors the current revision's outcome.
2. `currentRevisionId` is the row whose `revision` equals
   `currentRevisionNumber`.
3. Parent totals and `validUntil` equal the current revision's values.
4. `acceptedRevisionId` is set only when the parent is `ACCEPTED`.
5. `orderId` is set only when the parent is `ACCEPTED`.
6. A `SUPERSEDED` revision is never current.

### State machines

Parent: `DRAFT → SENT → ACCEPTED | REJECTED | VOID`; a revision from `SENT` or
`REJECTED` returns the parent to `DRAFT`. `ACCEPTED` and `VOID` are terminal for
revision creation.

Revision: `DRAFT → SENT → ACCEPTED | REJECTED | SUPERSEDED | VOID`.

Creating a revision copies the current content into a new `DRAFT` with the next
revision number, marks a previously `SENT` revision `SUPERSEDED`, and returns
the parent to `DRAFT`. A `REJECTED` revision keeps its terminal status; the new
draft is the next attempt.

### Expiry is derived

There is no stored `EXPIRED` status. A `SENT` quotation whose `validUntil` is
before today in the organisation timezone is expired. `validUntil` is an
inclusive calendar date, not a timestamp. Accept and convert refuse an expired
quotation with `409 INVALID_STATE`; the quotation may still be revised.

This avoids a scheduler, a write-on-read, and the possibility that a stored
status disagrees with the date beside it.

### Conversion copies, it does not reference

A sales order is built from the accepted revision's snapshot, not from live
products, companies, contacts, or the quotation. Every line, total, term, and
customer field is copied. The order is the record of what was sold. A later
price change or rename cannot alter it. ADR-0010 covers the document number;
the conversion itself is a single transaction with unique indexes on
`(organizationId, quotationId)` and `(organizationId, quotationRevisionId)` as
the idempotency backstop.

## Consequences

- Reading a quotation detail returns the parent, the current revision, and
  revision summaries. Historical content is addressable without a second
  timeline system.
- A draft delete marks the current revision `VOID` and soft-deletes the parent;
  a sent or accepted revision is never deleted.
- The parent totals are a cache with a testable invariant, not a second source
  of truth.
- The UI must show revisions explicitly; silently editing a sent quote is not
  possible, so the revise action is part of the screen.
- The conversion service reads the accepted revision, not the current pointer,
  so a superseding bug cannot change what an accepted quote meant.

## Rejected shortcuts

- Reusing the quotation document as its own first revision. Rejected: the
  parent and the content have different lifecycles; merging them recreates
  option A.
- Treating `validUntil` as a timestamp and expiring at midnight UTC. Rejected:
  the organisation timezone is the only defensible boundary for a calendar
  date, and the date helper already exists.
- Auto-converting on acceptance. Rejected: acceptance is the customer's
  decision; conversion is an operational step. Keeping them separate gives the
  conversion a clear, idempotent trigger.
