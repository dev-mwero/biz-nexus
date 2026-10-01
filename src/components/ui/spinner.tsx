import { cn } from "@/shared/lib/cn";

/**
 * Indeterminate progress.
 *
 * The border-based rotation is used rather than a translate or a conic gradient
 * because it is the one spinner that stays crisp at every size, inherits
 * `currentColor`, and costs no layout. `currentColor` is the whole trick: the
 * spinner takes the colour of whatever contains it, so a spinner inside a
 * primary button and one inside a critical badge are the same component.
 *
 * `role="status"` is asserted rather than swapped for `<output>`, which carries
 * form-association semantics and default browser styling and would be wrong
 * here. It is also opt-in: pass no `label` and the spinner is decorative,
 * leaving the announcement to the container. A spinner nested inside an
 * element that already exposes `aria-busy` must be silent, or the user hears
 * "loading" twice.
 *
 * `size` exists rather than leaving every call site to write `className="size-6"`
 * because the border has to grow with the box. A 2px border on a 24px circle is
 * a ring, not a spinner; scaling the box without the border turns it into one.
 */
const SPINNER_SIZES = {
  sm: "size-3 border-[1.5px]",
  md: "size-4 border-2",
  lg: "size-6 border-2",
} as const;

export function Spinner({
  className,
  size = "md",
  label,
}: {
  className?: string;
  size?: keyof typeof SPINNER_SIZES;
  /** Omit to make the spinner decorative. Supply to announce it. */
  label?: string;
}) {
  return (
    <span
      {...(label
        ? { role: "status" as const, "aria-label": label }
        : { "aria-hidden": true as const })}
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-current border-t-transparent",
        SPINNER_SIZES[size],
        className,
      )}
    />
  );
}
