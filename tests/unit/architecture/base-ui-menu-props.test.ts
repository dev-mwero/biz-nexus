import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Base UI menu items take `onClick`. Anything else is dropped on the floor.
 *
 * The menu primitives here are `@base-ui/react`, not Radix. Base UI items do not
 * accept `onSelect` — it is not in `MenuItem`'s prop types, and because the item
 * spreads its rest props onto a `div`, React discards the unknown attribute without
 * a warning in production. A handler passed that way is simply never called.
 *
 * Six of them were written that way, in three files: sign out, switch
 * organization, open settings, delete pipeline, mark one notification read, and
 * view all notifications. Every one rendered, was focusable, and did nothing.
 *
 * This class of bug is unusually well camouflaged. The prop is spelled like every
 * other click handler, it type-checks at the call site because `Menu.Item` is
 * exported through a wrapper whose own types are looser than the component's, and
 * the resulting markup is indistinguishable from correct. No snapshot catches it
 * and no screenshot catches it. Six dead controls across the shell, and the
 * e2e suite went green throughout because it drives the API rather than the
 * header.
 *
 * So it is checked here rather than left to review. A test is the only thing that
 * keeps a constraint true after the person who found it stops looking.
 */

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");

/** Radix-era props that Base UI silently ignores on menu items. */
const DROPPED_PROPS = ["onSelect"];

/**
 * JSX elements whose props Base UI drops. Only the menu is checked: `onSelect` is
 * also Radix's prop for `Tabs`, `Listbox` and `Select`, so the list is
 * deliberately short rather than speculative.
 */
const GUARDED_ELEMENTS = [
  "DropdownMenuItem",
  "Menu.Item",
  "DropdownMenuRadioItem",
  "Menu.RadioItem",
];

const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

/**
 * Strip comments so that prose about `onSelect` is not read as a violation.
 *
 * Handled by removing line comments and block comments wholesale, which can
 * theoretically join two lines together; that is acceptable here, since a joined
 * pair can only ever hide a match, never invent one.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every `path:line  prop= on a guarded element`, found on one line. */
function findViolations(dir: string): string[] {
  const violations: string[] = [];

  for (const file of walk(dir)) {
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    const rel = relative(PROJECT_ROOT, file);

    lines.forEach((line, index) => {
      for (const element of GUARDED_ELEMENTS) {
        const tag = new RegExp(`<${element.replace(".", "\\.")}\\b`);
        if (!tag.test(line)) continue;
        for (const prop of DROPPED_PROPS) {
          if (new RegExp(`\\b${prop}=`).test(line)) {
            violations.push(`${rel}:${index + 1}  ${prop}= on <${element}>`);
          }
        }
      }
    });
  }

  return violations;
}

describe("Base UI menu item props", () => {
  it("finds the props Base UI would drop, when they are present", () => {
    // If this test cannot fail, it cannot guard anything. The fixture is written
    // to the same shape as a violation, so a broken detector is caught here
    // rather than passing silently over the real source forever.
    const fixture = [
      "<DropdownMenuItem onClick={go}>Save</DropdownMenuItem>",
      "<DropdownMenuItem onSelect={gone}>Save</DropdownMenuItem>",
    ].join("\n");

    const flagged = fixture
      .split("\n")
      .flatMap((line) =>
        DROPPED_PROPS.filter((prop) =>
          new RegExp(`<DropdownMenuItem\\b.*\\b${prop}=`).test(line),
        ).map((prop) => `fixture  ${prop}= on <DropdownMenuItem>`),
      );

    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toContain("onSelect");
  });

  it("does not flag onClick", () => {
    const fixture = "<DropdownMenuItem onClick={go}>Save</DropdownMenuItem>";

    expect(
      DROPPED_PROPS.filter((prop) =>
        new RegExp(`<DropdownMenuItem\\b.*\\b${prop}=`).test(fixture),
      ),
    ).toEqual([]);
  });

  it("uses only props Base UI menu items actually accept", () => {
    const violations = findViolations(join(PROJECT_ROOT, "src"));

    expect(
      violations,
      violations.length
        ? [
            "Base UI menu items do not accept these props; the handlers are",
            "dropped without a warning and the controls do nothing:",
            ...violations.map((line) => `  ${line}`),
          ].join("\n")
        : "",
    ).toEqual([]);
  });
});
