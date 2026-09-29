/**
 * Display formatters.
 *
 * Every one of these is called on a server component, so `Intl` is used
 * directly rather than pulling in a formatting library. They are pure and
 * locale-aware, and the currency and date ones are cached because
 * `Intl.DateTimeFormat` construction is the expensive part, not the format.
 */

type Locale = string | undefined;

const DEFAULT_LOCALE = "en-US";

/* ── Currency ─────────────────────────────────────────────────────────────── */

const currencyFormatters = new Map<string, Intl.NumberFormat>();

/**
 * Money, in major units, in the given currency.
 *
 * `fractionDigits` defaults to the currency's own convention rather than a
 * fixed 2, because not every currency has two decimal places and rendering JPY
 * as "¥1,200.00" is a correctness bug, not a style choice.
 */
export function formatCurrency(
  value: number,
  currency = "USD",
  locale: Locale = undefined,
  options: { compact?: boolean; maximumFractionDigits?: number } = {},
): string {
  const digits = options.maximumFractionDigits;
  const key = `${locale ?? DEFAULT_LOCALE}:${currency}:${digits ?? "auto"}:${
    options.compact ? "compact" : "full"
  }`;

  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    const resolvedCurrency = currency.toUpperCase();
    formatter = new Intl.NumberFormat(locale ?? DEFAULT_LOCALE, {
      style: "currency",
      currency: resolvedCurrency,
      ...(options.compact && { notation: "compact" as const }),
      ...(digits !== undefined && { maximumFractionDigits: digits }),
    });
    currencyFormatters.set(key, formatter);
  }

  return formatter.format(value);
}

/**
 * Currency at a fixed precision, for table cells where a column of values must
 * line up regardless of each value's own currency convention.
 */
export function formatCurrencyCompact(
  value: number,
  currency = "USD",
  locale: Locale = undefined,
): string {
  return formatCurrency(value, currency, locale, { maximumFractionDigits: 0 });
}

/* ── Numbers ──────────────────────────────────────────────────────────────── */

export function formatNumber(
  value: number,
  locale: Locale = undefined,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale ?? DEFAULT_LOCALE, options).format(value);
}

/** 1,200 → "1.2k". For axis labels and dense tiles, not for exact figures. */
export function formatCompactNumber(
  value: number,
  locale: Locale = undefined,
): string {
  return new Intl.NumberFormat(locale ?? DEFAULT_LOCALE, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/* ── Dates and times ──────────────────────────────────────────────────────── */

/**
 * A date with no time component, in the given IANA timezone.
 *
 * The timezone is explicit and required to be passed through: a user in
 * Nairobi and a user in Lisbon must see the same date recorded at the same
 * instant, and the server's local zone is never the answer.
 */
export function formatDate(
  value: Date | string | number,
  timeZone = "UTC",
  locale: Locale = undefined,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locale ?? DEFAULT_LOCALE, {
    dateStyle: "medium",
    timeZone,
    ...options,
  }).format(toDate(value));
}

export function formatDateTime(
  value: Date | string | number,
  timeZone = "UTC",
  locale: Locale = undefined,
): string {
  return new Intl.DateTimeFormat(locale ?? DEFAULT_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(toDate(value));
}

/** "3 days ago", "in 2 hours". */
export function formatRelativeTime(
  value: Date | string | number,
  locale: Locale = undefined,
  now: Date = new Date(),
): string {
  const target = toDate(value);
  const deltaSeconds = (target.getTime() - now.getTime()) / 1000;

  // Intl collapses anything under a minute to "now", including future
  // timestamps within it, which reads as a bug rather than a rounding.
  if (Math.abs(deltaSeconds) < 60) {
    return "just now";
  }

  const formatter = new Intl.RelativeTimeFormat(locale ?? DEFAULT_LOCALE, {
    numeric: "auto",
  });

  const thresholds: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];

  const abs = Math.abs(deltaSeconds);
  for (const [unit, secondsInUnit] of thresholds) {
    if (abs >= secondsInUnit) {
      return formatter.format(Math.round(deltaSeconds / secondsInUnit), unit);
    }
  }

  return formatter.format(Math.round(deltaSeconds / 60), "minute");
}

/** Whole days between two instants, ignoring the time of day. */
export function daysBetween(from: Date, to: Date): number {
  const start = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((end - start) / 86_400_000);
}

export function isOverdue(
  dueAt: Date | string,
  now: Date = new Date(),
): boolean {
  return toDate(dueAt).getTime() < now.getTime();
}

/* ── Text ─────────────────────────────────────────────────────────────────── */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string)[0]}${(parts[1] as string)[0]}`.toUpperCase();
}

const LEGAL_SUFFIXES = new Set([
  "ltd",
  "inc",
  "llc",
  "plc",
  "gmbh",
  "corp",
  "co",
  "the",
  "sa",
  "bv",
  "ag",
  "pty",
]);

/** "Acme Ltd" → "AC", "Globex Inc." → "GL", "Northwind Trading" → "NT". */
export function companyInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  const significant = words.filter(
    (word) => !LEGAL_SUFFIXES.has(word.toLowerCase().replace(/[.,]/g, "")),
  );
  const source = significant.length > 0 ? significant : words;

  // A single significant word gives its first two characters. Taking only the
  // first letter would render "Acme Ltd" as "A" and every single-word company
  // with a one-letter avatar.
  if (source.length === 1) {
    return (source[0] as string).slice(0, 2).toUpperCase();
  }

  return source
    .slice(0, 2)
    .map((word) => (word[0] as string).toUpperCase())
    .join("");
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/** "Ada Lovelace", "bob@example.com" → "AL", "BE". Stable per user. */
export function avatarFallback(seed: string): string {
  const cleaned = seed.trim();
  if (cleaned.includes("@")) {
    return companyInitials(cleaned.split("@")[0] as string);
  }
  return initials(cleaned);
}

/* ── Internal ─────────────────────────────────────────────────────────────── */

function toDate(value: Date | string | number): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid date value: ${String(value)}`);
  }
  return date;
}
