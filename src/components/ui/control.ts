import { cn } from "@/shared/lib/cn";

/**
 * The single definition of what an editable control looks like.
 *
 * Input, textarea, and the select trigger must be pixel-identical in height,
 * border, and focus treatment, or a form built from them looks broken. That
 * consistency is the reason this lives in one exported constant rather than
 * being written out three times and drifting.
 *
 * The 32px content box plus a 1px border gives the 36px outer height that
 * matches `buttonVariants` at `size: "md"`, so a submit button beside an input
 * is the same height without anyone tuning it.
 *
 * There are deliberately no `dark:` overrides here. The ink ramp inverts —
 * `ink-900` is near-black in light mode and near-white in dark — so the same
 * utility that gives a white input with black text in one mode gives a dark
 * input with light text in the other. Reaching for `dark:bg-ink-900` to "fix"
 * a control would turn it near-white on a dark card.
 *
 * This is a plain string, not a `cva` factory: there are no variants to
 * parameterise, and exporting the factory would hand callers a function that
 * `clsx` discards without complaint — leaving a control with no styling at all
 * and nothing in the type system to say so.
 */
const CONTROL_CLASSES = [
  "w-full rounded-md border border-line-strong bg-surface text-sm text-ink-900",
  "transition-[border-color,box-shadow] duration-[var(--bn-duration-fast)]",
  "placeholder:text-ink-400",
  // A filled focus state rather than an outline: a focus ring inside a control
  // cannot be confused with a validation border, because they are the same box.
  "focus:border-ink-700 focus:ring-2 focus:ring-ink-900/15 focus:outline-none",
  "dark:focus:ring-ink-100/20",
  // aria-invalid, not a prop, so the visual state cannot drift from the
  // accessibility state. A field that looks valid but announces itself invalid
  // is worse than one that never turned red.
  "aria-invalid:border-critical aria-invalid:ring-critical/15",
  "dark:aria-invalid:ring-critical/25",
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-400",
  "read-only:bg-surface-sunken",
] as const;

export const controlVariants: string = cn(CONTROL_CLASSES);
