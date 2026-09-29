import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Status pill.
 *
 * The `tone` variants are bound to the four semantic statuses and nothing else.
 * A badge is the one place a small amount of chroma is correct, because it
 * communicates state and not decoration — a green "Paid" carries information
 * that "Paid" in grey does not.
 *
 * `dot` is for status a user scans a column of. The dot is redundant with the
 * colour on purpose: it survives a greyscale print, and it is the part a
 * colour-blind user can still locate.
 */
export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral:
          "border-neutral-border bg-neutral-surface text-ink-600 dark:border-neutral-border dark:bg-ink-100 dark:text-ink-700",
        positive:
          "border-positive-border bg-positive-surface text-positive dark:border-positive/40 dark:bg-positive/15 dark:text-positive",
        attention:
          "border-attention-border bg-attention-surface text-attention dark:border-attention/40 dark:bg-attention/15 dark:text-attention",
        critical:
          "border-critical-border bg-critical-surface text-critical dark:border-critical/40 dark:bg-critical/15 dark:text-critical",
        info: "border-info-border bg-info-surface text-info dark:border-info/40 dark:bg-info/15 dark:text-info",
        // Outline is the quiet option for filters and inactive tabs, where a
        // filled pill would imply a state that does not exist.
        outline:
          "border-line-strong bg-transparent text-ink-600 dark:border-ink-600 dark:text-ink-300",
      },
      size: {
        sm: "px-2 py-0.5 text-2xs",
        md: "px-2.5 py-0.5 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export type BadgeProps = ComponentPropsWithoutRef<"span"> &
  VariantProps<typeof badgeVariants> & { dot?: boolean };

export function Badge({
  className,
  tone,
  size,
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ tone, size }), className)}
      {...props}
    >
      {dot ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}
