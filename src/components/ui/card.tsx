import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * A surface with a defined edge.
 *
 * `plain` is the default. A card is a grouping device, and in a layout where
 * every region is already a bordered surface, adding a second border around
 * content is how a screen turns into a grid of boxes. `plain` groups without
 * drawing; the other variants exist for the cases that genuinely need the edge.
 */
export const cardVariants = cva("rounded-lg", {
  variants: {
    variant: {
      plain: "bg-surface",
      outlined: "border border-line bg-surface dark:border-line",
      elevated:
        "border border-line bg-surface-raised shadow-md dark:border-line",
      sunken: "border border-line bg-surface-sunken dark:border-line",
    },
  },
  defaultVariants: { variant: "plain" },
});

export function Card({
  className,
  variant,
  ...props
}: ComponentPropsWithoutRef<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="card"
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "flex flex-col gap-1 px-4 pt-4 pb-3 sm:px-5 sm:pt-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn(
        "font-display text-md font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-ink-500 dark:text-ink-400", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-4 pb-4 sm:px-5 sm:pb-5", className)}
      {...props}
    />
  );
}

export function CardFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center gap-2 border-t border-line px-4 py-3 sm:px-5 dark:border-line",
        className,
      )}
      {...props}
    />
  );
}
