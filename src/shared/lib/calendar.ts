/**
 * Calendar dates in an organisation's timezone.
 *
 * A quotation's `validUntil` is a date, not an instant. "Valid until 31
 * October" means through the end of that day where the organisation is, not at
 * midnight UTC. The server's local timezone is never the answer; a user in
 * Nairobi and a user in Lisbon must agree on when the document expires.
 *
 * Stored as `YYYY-MM-DD` so the value has no time component to drift, and so
 * Mongo can compare and sort it lexicographically.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function partsInTimeZone(
  timeZone: string,
  now: Date,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const day = Number(values.get("day"));

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new RangeError(`Could not resolve a date in "${timeZone}".`);
  }

  return { year, month, day };
}

/**
 * Today's date in the given IANA timezone, as `YYYY-MM-DD`.
 *
 * `now` is injectable so tests and services can pin the clock without stubbing
 * the global `Date`.
 */
export function todayInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("todayInTimeZone needs a valid Date.");
  }

  const { year, month, day } = partsInTimeZone(timeZone, now);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The year in the given timezone, used for document numbering. */
export function yearInTimeZone(
  timeZone: string,
  now: Date = new Date(),
): number {
  return partsInTimeZone(timeZone, now).year;
}

/**
 * Whether a string is a real calendar date.
 *
 * `2026-02-30` matches the shape and is not a date. Parsing through
 * `Date.UTC` and comparing the parts back catches the rolling behaviour that
 * would otherwise turn it into 2 March.
 */
export function isValidCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Lexicographic comparison is chronological for `YYYY-MM-DD`. */
export function compareCalendarDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
