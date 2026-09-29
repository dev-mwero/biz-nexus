import { describe, expect, it } from "vitest";
import { cn } from "@/shared/lib/cn";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("lets the last conflicting Tailwind utility win", () => {
    // Without twMerge the result is "p-2 p-4" and the override depends on
    // stylesheet order, which is how component overrides silently stop working.
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("resolves conflicts within a property group and keeps the rest", () => {
    // text-sm and text-lg are the same group, so the later one wins and the
    // earlier is dropped. The colour is a different group and survives.
    const result = cn("text-sm text-ink-500", "text-lg");
    expect(result).toContain("text-lg");
    expect(result).not.toContain("text-sm");
    expect(result).toContain("text-ink-500");
  });

  it("supports conditional objects and arrays", () => {
    expect(cn(["a", { b: true, c: false }])).toBe("a b");
  });
});
