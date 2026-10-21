import { describe, expect, it } from "vitest";
import {
  compareCalendarDates,
  isValidCalendarDate,
  todayInTimeZone,
  yearInTimeZone,
} from "@/shared/lib/calendar";

describe("todayInTimeZone", () => {
  // The same instant is a different date depending on where the organisation
  // is. Returning the server's date would expire a quote a day early or late.
  const instant = new Date("2026-10-19T23:30:00.000Z");

  it("uses the local date in the requested timezone", () => {
    expect(todayInTimeZone("UTC", instant)).toBe("2026-10-19");
    expect(todayInTimeZone("Africa/Nairobi", instant)).toBe("2026-10-20");
    expect(todayInTimeZone("America/Los_Angeles", instant)).toBe("2026-10-19");
  });

  it("crosses the date line in both directions", () => {
    expect(todayInTimeZone("Pacific/Kiritimati", instant)).toBe("2026-10-20");
    expect(todayInTimeZone("Pacific/Pago_Pago", instant)).toBe("2026-10-19");
  });

  it("handles a timezone with daylight saving", () => {
    // 07:30Z is 03:30 in New York during EDT and 08:30 local in Berlin.
    const dst = new Date("2026-07-01T07:30:00.000Z");
    expect(todayInTimeZone("America/New_York", dst)).toBe("2026-07-01");
    expect(todayInTimeZone("Europe/Berlin", dst)).toBe("2026-07-01");
  });

  it("rejects an invalid date", () => {
    expect(() => todayInTimeZone("UTC", new Date("nope"))).toThrow(TypeError);
  });

  it("rejects an unknown timezone", () => {
    expect(() => todayInTimeZone("Mars/Olympus_Mons")).toThrow(RangeError);
  });
});

describe("yearInTimeZone", () => {
  it("uses the local year for document numbering", () => {
    const newYear = new Date("2025-12-31T23:30:00.000Z");
    expect(yearInTimeZone("UTC", newYear)).toBe(2025);
    expect(yearInTimeZone("Africa/Nairobi", newYear)).toBe(2026);
  });
});

describe("isValidCalendarDate", () => {
  it("accepts real dates", () => {
    expect(isValidCalendarDate("2026-10-19")).toBe(true);
    expect(isValidCalendarDate("2024-02-29")).toBe(true);
  });

  it("rejects dates that only look valid", () => {
    expect(isValidCalendarDate("2026-02-29")).toBe(false);
    expect(isValidCalendarDate("2026-02-30")).toBe(false);
    expect(isValidCalendarDate("2026-13-01")).toBe(false);
    expect(isValidCalendarDate("2026-00-10")).toBe(false);
    expect(isValidCalendarDate("2026-10-00")).toBe(false);
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    for (const value of [
      "",
      "2026-1-1",
      "19-10-2026",
      "2026/10/19",
      "2026-10-19T00:00:00Z",
    ]) {
      expect(isValidCalendarDate(value), value).toBe(false);
    }
  });
});

describe("compareCalendarDates", () => {
  it("orders dates chronologically", () => {
    expect(compareCalendarDates("2026-10-19", "2026-10-20")).toBe(-1);
    expect(compareCalendarDates("2026-10-20", "2026-10-19")).toBe(1);
    expect(compareCalendarDates("2026-10-19", "2026-10-19")).toBe(0);
  });
});
