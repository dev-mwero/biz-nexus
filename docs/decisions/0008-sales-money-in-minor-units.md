# ADR-0008 — Sales documents store money in integer minor units

- **Status:** accepted
- **Date:** 2026-10-19
- **Affects:** `src/modules/products`, `src/modules/quotations`,
  `src/modules/sales-orders`, `src/shared/lib/money.ts`, `docs/API.md` §22,
  `docs/DATABASE.md`, the Stage 2 UI

## Context

Stage 1 stored `Deal.value` as a JavaScript number in major units, with a note in
`docs/DATABASE.md` that this was acceptable for pipeline estimates and must be
revisited before Finance. Stage 2 is the first part of the product that has to
*calculate* money rather than display an estimate: a quotation has quantities,
unit prices, per-line tax, rounding, and totals that must add up exactly; a
sales order must preserve those totals as a historical record.

Binary floating point cannot represent most decimal fractions exactly. A line of
`0.1 × 3` is not `0.3`, and a sequence of line totals that is summed in a
different order can differ by a minor unit. For a quotation that a customer
receives, that is a correctness defect, not a rounding style.

The existing API convention says money is "a decimal number in major units plus
a `currency` code". That convention was written for deal values, before there
was a document that needed arithmetic. Keeping it for sales documents would
mean either sending floats over the wire or sending decimal strings that every
caller must parse, and both leave the exactness question to the caller.

## Options considered

**A. Continue with major-unit numbers everywhere.** Rejected for sales. It is
the current deal convention, but it makes `0.1 + 0.2` a business calculation,
and rounding at the boundary is exactly where disputes come from. It also leaves
the server and the line editor each free to round differently.

**B. `Decimal128` in MongoDB and decimal strings on the wire.** Exact, and it
matches what a finance system eventually wants. Rejected for Stage 2: Mongoose
surfaces `Decimal128` as a driver object, so every read, write, JSON boundary,
test, and UI form has to convert explicitly. It also adds a second numeric
representation to a codebase that already has one. The benefit over integers is
only relevant for currencies with more precision than the minor unit, which
this product does not support.

**C. Integer minor units in storage and on the wire, with a shared arithmetic
module.** **Chosen.** An amount is an integer number of the currency's smallest
unit: `1250` is `$12.50` in USD, `1250` is `¥1250` in JPY. Addition is exact,
comparison is exact, JSON is a number, and the rounding rule lives in one pure
function that the server and the UI both call.

## Decision

All money in the Sales domain is stored and transmitted as an integer in minor
units, alongside an ISO 4217 currency code.

```
unitPriceMinor      integer, the agreed price per unit
listPriceMinor      integer, the product list price at the time of writing
lineSubtotalMinor   integer, after quantity rounding
lineTaxMinor        integer, after tax rounding
lineTotalMinor      integer
subtotalMinor       integer, sum of line subtotals
taxMinor            integer, sum of line taxes
totalMinor          integer, sum of line totals
```

**Quantities** are integers in thousandths (`quantityMilli`): `1500` is `1.5`.
**Tax rates** are integers in basis points (`taxRateBps`): `1600` is `16%`.
Neither is a float on the wire.

**Arithmetic lives in `src/shared/lib/money.ts`**, is pure, and uses `BigInt`
for the intermediate product before rounding:

```
lineSubtotalMinor = roundHalfUp(unitPriceMinor × quantityMilli, 1000)
lineTaxMinor      = roundHalfUp(lineSubtotalMinor × taxRateBps, 10000)
lineTotalMinor    = lineSubtotalMinor + lineTaxMinor
```

Document totals are the sum of already-rounded line values. There is no
document-level rounding adjustment: a discount that exists only as a rounding
remainder is a surprise on the customer's document.

**Rounding is half-up, ties away from zero**, for non-negative values. The
function rejects unsafe integers and amounts beyond the documented caps rather
than silently losing precision.

### The `Deal.value` boundary

`Deal.value` stays a major-unit number in Stage 2. Sales documents never read it
and never write it. Mixing the two representations in one calculation is the
bug this ADR exists to prevent, so the boundary is explicit:

- Deal forecasting continues to use the Stage 1 semantics.
- Products, quotations, and sales orders use minor units.
- The API convention in `docs/API.md` §22 is amended to state the carve-out.
- **Gate 2 owns the migration.** Before Finance starts, `Deal.value` must move
  to minor units (or be given an explicit, documented exception) with a data
  migration and a new ADR. Finance cannot be built on two money
  representations.

### Currency exponents

`minorUnitDigits(currency)` uses an explicit table: 0 for BIF, CLP, DJF, GNF,
ISK, JPY, KMF, KRW, PYG, RWF, UGX, UYI, VND, VUV, XAF, XOF, XPF; 3 for BHD, IQD,
JOD, KWD, LYD, OMR, TND; 4 for CLF and UYW; 2 for everything else. An unknown
three-letter code uses 2 rather than throwing, because an organisation may
already hold a code the table does not name and a read must not fail on it.

## Consequences

- A single arithmetic module is the only place money is calculated. The quote
  line editor and the server call the same functions; the server remains
  authoritative.
- Display converts with `fromMinorUnits` and then the existing
  `formatCurrency`. A displayed value is never fed back into arithmetic.
- Database and API fields are self-describing (`…Minor`), so a reviewer can see
  which representation a field uses without consulting this document.
- `docs/API.md` must not claim all money is major units. The convention is
  amended in the same change that adds the first sales endpoint.
- The Gate 2 criteria gain an explicit item: migrate `Deal.value` or record a
  decision not to, before Finance.

## Rejected shortcuts

- Storing a float and rounding on display. Rejected: the stored value is the
  record, and a display-time round cannot repair an accumulated error.
- Storing a decimal string. Rejected: every arithmetic call site becomes a
  parsing site, and comparison/sorting in MongoDB becomes lexical.
- A separate money type per currency. Rejected: the exponent is data, not a
  type; the currency code already carries it.
