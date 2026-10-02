"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/shared/lib/cn";
import { Button, type ButtonProps } from "./button";

/**
 * Page navigation for an offset-paginated list.
 *
 * The window is what makes this usable rather than decorative. Ten thousand
 * records at twenty per page is 500 buttons, and a strip of 500 is wider than
 * the screen it sits in and pushes the record count it is meant to accompany off
 * the edge. Seven slots — first, last, and up to five around the current page
 * with ellipses between — fit inside a card footer at every page count.
 *
 * Number buttons rather than a `<select>` because the target is a known page,
 * not an unknown one. A user paging back through results they have already seen
 * is looking for the position, not choosing a destination.
 *
 * The count is announced as live content because a page change is silent
 * otherwise: the table updates and the user is left unsure whether the click
 * registered. `aria-current` marks the active number so it is not read as an
 * ordinary button.
 */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  className,
  siblingCount = 1,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  /** Pages shown either side of the current one, inside the window. */
  siblingCount?: number;
}) {
  const pages = useMemo(
    () => buildPageWindow(page, totalPages, siblingCount),
    [page, totalPages, siblingCount],
  );

  if (totalPages <= 1) return null;

  return (
    <nav
      data-slot="pagination"
      aria-label="Pagination"
      className={cn("flex items-center gap-1", className)}
    >
      <PaginationStep
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        label="Previous page"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </PaginationStep>

      {pages.map((entry) => {
        const target = entry.page;
        return target === null ? (
          <span
            key={entry.key}
            aria-hidden="true"
            className="px-1 text-sm text-ink-400"
          >
            …
          </span>
        ) : (
          <PaginationStep
            key={entry.key}
            onClick={() => onPageChange(target)}
            label={`Page ${target}`}
            aria-current={target === page ? "page" : undefined}
            variant={target === page ? "primary" : "ghost"}
          >
            {target}
          </PaginationStep>
        );
      })}

      <PaginationStep
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        label="Next page"
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </PaginationStep>
    </nav>
  );
}

/** A rendered slot in the window: either a page number, or an ellipsis. */
type PageSlot = { key: string; page: number | null };

type PaginationStepProps = Omit<ButtonProps, "size" | "children"> & {
  label: string;
  children: React.ReactNode;
};

function PaginationStep({
  label,
  children,
  className,
  ...props
}: PaginationStepProps) {
  return (
    <Button
      size="icon-sm"
      aria-label={label}
      title={label}
      className={cn("text-xs tabular-nums", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

/**
 * First page, last page, the current page with `siblingCount` either side, and
 * an ellipsis wherever a run of pages was dropped.
 *
 * The edges are always present even when the window would otherwise reach them.
 * "Jump to first" is worth a slot on every page but the first, because back is
 * the direction people move in.
 */
function buildPageWindow(
  page: number,
  totalPages: number,
  siblingCount: number,
): PageSlot[] {
  const first = 1;
  const last = totalPages;
  // first + last + current + siblings + two gaps, floored at the edges.
  const capacity = siblingCount * 2 + 5;
  const entries = new Set<number>([first, last]);

  if (totalPages <= capacity) {
    for (let index = first; index <= last; index += 1) entries.add(index);
  } else {
    const start = Math.min(Math.max(page - siblingCount, first), last);
    const end = Math.min(Math.max(page + siblingCount, first), last);
    for (let index = start; index <= end; index += 1) entries.add(index);
  }

  const sorted = [...entries].sort((a, b) => a - b);
  const slots: PageSlot[] = [];
  let previous = 0;
  for (const entry of sorted) {
    // The ellipsis is keyed by the page it stands in for, not by its position,
    // so that paging forward reuses the same element instead of remounting it.
    if (previous && entry - previous > 1) {
      slots.push({ key: `gap-${entry}`, page: null });
    }
    slots.push({ key: `page-${entry}`, page: entry });
    previous = entry;
  }
  return slots;
}
