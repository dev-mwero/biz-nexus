import { describe, expect, it } from "vitest";
import {
  avatarFallback,
  companyInitials,
  daysBetween,
  formatCompactNumber,
  formatCurrency,
  formatDate,
  formatNumber,
  formatRelativeTime,
  initials,
  isOverdue,
  truncate,
} from "@/shared/lib/format";

describe("formatCurrency", () => {
  it("formats in the requested currency", () => {
    expect(formatCurrency(1234.5, "USD", "en-US")).toBe("$1,234.50");
    expect(formatCurrency(1234.5, "EUR", "en-US")).toBe("€1,234.50");
  });

  it("uses the currency's own decimal convention", () => {
    // JPY has no minor unit. Rendering it with two decimals is a correctness
    // bug, not a style preference.
    expect(formatCurrency(1200, "JPY", "en-US")).toBe("¥1,200");
  });

  it("honours an explicit fraction digit override", () => {
    expect(
      formatCurrency(1234.5, "USD", "en-US", { maximumFractionDigits: 0 }),
    ).toBe("$1,235");
  });

  it("formats zero and negative values", () => {
    expect(formatCurrency(0, "USD", "en-US")).toBe("$0.00");
    expect(formatCurrency(-500, "USD", "en-US")).toBe("-$500.00");
  });
});

describe("formatNumber and formatCompactNumber", () => {
  it("groups thousands", () => {
    expect(formatNumber(1234567, "en-US")).toBe("1,234,567");
  });

  it("abbreviates large values", () => {
    expect(formatCompactNumber(1200, "en-US")).toBe("1.2K");
  });
});

describe("formatDate", () => {
  it("formats in the given timezone", () => {
    // The same instant is a different date in each zone. Defaulting to the
    // server's zone would show a user in Nairobi the wrong day.
    const instant = new Date("2026-03-01T00:30:00.000Z");
    expect(formatDate(instant, "UTC", "en-US")).toBe("Mar 1, 2026");
    expect(formatDate(instant, "Africa/Nairobi", "en-US")).toBe("Mar 1, 2026");
    expect(formatDate(instant, "America/Los_Angeles", "en-US")).toBe(
      "Feb 28, 2026",
    );
  });

  it("accepts ISO strings", () => {
    expect(formatDate("2026-03-01T00:30:00.000Z", "UTC", "en-US")).toBe(
      "Mar 1, 2026",
    );
  });

  it("throws rather than rendering Invalid Date", () => {
    expect(() => formatDate("not-a-date")).toThrow(TypeError);
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("collapses sub-minute differences to 'just now'", () => {
    expect(
      formatRelativeTime(new Date("2026-06-15T11:59:40.000Z"), "en-US", now),
    ).toBe("just now");
  });

  it("describes past durations", () => {
    expect(
      formatRelativeTime(new Date("2026-06-12T12:00:00.000Z"), "en-US", now),
    ).toBe("3 days ago");
  });

  it("describes future durations", () => {
    expect(
      formatRelativeTime(new Date("2026-06-16T12:00:00.000Z"), "en-US", now),
    ).toBe("tomorrow");
  });

  it("handles years", () => {
    expect(
      formatRelativeTime(new Date("2025-06-15T12:00:00.000Z"), "en-US", now),
    ).toBe("last year");
  });
});

describe("daysBetween", () => {
  it("ignores the time of day", () => {
    expect(
      daysBetween(
        new Date("2026-06-15T23:00:00.000Z"),
        new Date("2026-06-16T01:00:00.000Z"),
      ),
    ).toBe(1);
  });

  it("returns a negative span when reversed", () => {
    expect(
      daysBetween(
        new Date("2026-06-16T00:00:00.000Z"),
        new Date("2026-06-15T00:00:00.000Z"),
      ),
    ).toBe(-1);
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("is true for a past due date", () => {
    expect(isOverdue(new Date("2026-06-14T12:00:00.000Z"), now)).toBe(true);
  });

  it("is false for a future due date", () => {
    expect(isOverdue(new Date("2026-06-16T12:00:00.000Z"), now)).toBe(false);
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
  });

  it("takes two letters from a single word", () => {
    expect(initials("Madonna")).toBe("MA");
  });

  it("ignores extra whitespace", () => {
    expect(initials("  Grace   Brewster  Hopper ")).toBe("GB");
  });

  it("degrades safely on empty input", () => {
    expect(initials("")).toBe("?");
  });
});

describe("companyInitials", () => {
  it("skips legal suffixes", () => {
    // With the suffix removed only one significant word remains, so it
    // contributes two characters rather than one.
    expect(companyInitials("Acme Ltd")).toBe("AC");
    expect(companyInitials("Globex Inc.")).toBe("GL");
  });

  it("uses the first two significant words", () => {
    expect(companyInitials("Northwind Trading Company")).toBe("NT");
  });
});

describe("avatarFallback", () => {
  it("derives from a name", () => {
    expect(avatarFallback("Ada Lovelace")).toBe("AL");
  });

  it("derives from the local part of an email", () => {
    expect(avatarFallback("bob@example.com")).toBe("BO");
  });
});

describe("truncate", () => {
  it("leaves short strings untouched", () => {
    expect(truncate("short", 20)).toBe("short");
  });

  it("truncates with an ellipsis", () => {
    expect(truncate("a very long company name indeed", 10)).toBe("a very lo…");
  });

  it("does not exceed the requested length", () => {
    expect(truncate("abcdefghij", 5)).toHaveLength(5);
  });
});
