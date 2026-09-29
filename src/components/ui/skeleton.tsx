import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Loading placeholder.
 *
 * The shimmer animation is defined in globals.css rather than inline because it
 * is a `background-position` loop, which is compositor-friendly, and because
 * putting it in CSS keeps the reduced-motion override global instead of
 * depending on every call site remembering it.
 */
export function Skeleton({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("skeleton bg-ink-100", className)}
      {...props}
    />
  );
}

/**
 * A skeleton that reserves a realistic shape.
 *
 * A single generic bar repeated down a table teaches the user nothing about
 * what is loading and produces a layout shift when the real rows arrive at
 * different heights. The variants here match the shapes actually rendered —
 * avatar, title, paragraph, table cell — so the swap is not a jump.
 */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: positional placeholders have no identity and never reorder, so the index is the correct key. A stable id would imply one that does not exist.
          key={index}
          className={cn("h-3", index === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}
