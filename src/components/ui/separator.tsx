"use client";

import { Separator as BaseSeparator } from "@base-ui/react/separator";
import { cn } from "@/shared/lib/cn";

/**
 * A hairline between sections.
 *
 * `line` is the default because most separators in a dense tool are dividing
 * two lists rather than two regions. `line-strong` exists for the case where
 * the separator is doing the work of a section boundary, and a one-pixel
 * `line` cannot carry that much weight against `surface-raised`.
 *
 * `orientation` is passed through rather than inferred from a `horizontal`
 * boolean, because it is the orientation that decides which dimension collapses
 * and getting it wrong yields a 1px-tall element inside a vertical stack.
 */
export function Separator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSeparator>) {
  return (
    <BaseSeparator
      data-slot="separator"
      className={cn(
        "shrink-0 border-0 bg-line dark:bg-line-strong",
        "data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full",
        "data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className,
      )}
      {...props}
    />
  );
}

/** The stronger of the two, for a genuine boundary between regions. */
export function SeparatorStrong({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSeparator>) {
  return (
    <Separator
      className={cn("bg-line-strong dark:bg-ink-300", className)}
      {...props}
    />
  );
}
