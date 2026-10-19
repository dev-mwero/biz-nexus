# ADR-0010 — Document numbers come from an organisation-scoped atomic counter

- **Status:** accepted
- **Date:** 2026-10-19
- **Affects:** `src/modules/document-numbers`, `src/modules/quotations`,
  `src/modules/sales-orders`, `docs/DATABASE.md`

## Context

Quotations and sales orders need human-readable numbers that a customer can
quote on the phone: `Q-2026-000001`, `SO-2026-000042`. The number must be unique
within an organisation, should be roughly sequential, and must not collide when
two requests create a document at the same moment on two serverless instances.

MongoDB has no sequences. The obvious approach — `countDocuments() + 1` — is a
race: two concurrent counts see the same total, both produce the same number,
and the unique index turns the second into a 500 after the user has filled in a
form.

Numbers are also tenant data. Organisation A's `Q-2026-000001` and Organisation
B's `Q-2026-000001` are unrelated, and neither should be able to infer the
other's volume from its own sequence.

## Options considered

**A. `countDocuments() + 1`.** Rejected: races, duplicates, and a full count on
every creation. A retry loop around a unique index works but turns ordinary
concurrency into error handling.

**B. A timestamp or random suffix** (`Q-2026-7F3K9`). Rejected: unique and
race-free, but not sequential and unpleasant to read aloud or search. Customers
expect the next number to be the next number.

**C. Allocate a block of numbers per process and hand them out in memory.**
Rejected for Stage 2: it avoids contention but creates gaps on every redeploy
and needs a block size decision that this product's volume does not justify.

**D. One counter row per organisation, document type, and year, incremented
atomically with `findOneAndUpdate` and `$inc` inside the caller's transaction.**
**Chosen.**

## Decision

Collection `document_sequences`:

```
{ organizationId, documentType: "QUOTATION" | "SALES_ORDER", year, value }
```

Unique index on `(organizationId, documentType, year)`.

Allocation:

```
findOneAndUpdate(
  { organizationId, documentType, year },
  { $inc: { value: 1 } },
  { upsert: true, returnDocument: "after", session }
)
```

The returned `value` is formatted:

- quotation: `Q-{year}-{value padded to 6 digits}`
- sales order: `SO-{year}-{value padded to 6 digits}`

A value beyond 999,999 continues to 7+ digits rather than truncating.

The year is the organisation-timezone year at allocation, not the server's
local year and not UTC.

### Allocation points

- A quotation gets its number at **creation**, because a draft needs a number in
  the UI and on screen.
- A sales order gets its number at **conversion**, because an order cannot exist
  before an accepted quotation is converted.

Quotation creation and order conversion both run inside `withTransaction`, so
the `$inc` is part of the same unit of work. A rolled-back transaction also
rolls back its counter increment, and the number becomes available again.

A deleted draft leaves a gap. That is accepted and documented: the alternative
is a number-reuse scheme whose failure mode is two documents with the same
number.

### Concurrency

The atomic `$inc` is the primary mechanism. The unique index on the counter row
and the unique index on `(organizationId, number)` are the backstops. If a
duplicate-key race still surfaces, `withTransaction` retries the callback; the
service does not swallow the error or fall back to `count + 1`.

Numbers are never reused within a sequence, and sequences are per organisation.
There is no global sequence and no endpoint that exposes one organisation's
counter to another.

## Consequences

- `document_sequences` is tenant-owned and uses `TenantRepository`, like every
  other collection.
- The numbering module is separate from quotations and orders, so neither
  module imports the other to allocate a number.
- The counter is a contention point at high creation rates. At this product's
  SMB scale one row per organisation/year is correct; a block allocator is a
  later change with its own ADR.
- The UI shows a gap after a deleted draft. This is normal for business
  documents and is not repaired.
- Tests must cover: two organisations starting at 1, concurrent allocation
  producing unique numbers, year rollover, and rollback not consuming a number.

## Rejected shortcuts

- A global counter. Rejected: it leaks volume across tenants and creates one
  hot row for the whole platform.
- A random suffix to hide gaps. Rejected: it defeats the readability that is
  the entire reason for a sequential number.
- Formatting in the database. Rejected: the stored value is an integer; the
  prefix and padding are presentation and belong in one function.
