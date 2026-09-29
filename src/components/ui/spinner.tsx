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
 */
export function Spinner({
  className,
  label,
}: {
  className?: string;
  /** Omit to make the spinner decorative. Supply to announce it. */
  label?: string;
}) {
  return (
    <span
      {...(label
        ? { role: "status" as const, "aria-label": label }
        : { "aria-hidden": true as const })}
      className={cn(
        "inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}
