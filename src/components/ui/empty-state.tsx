import type { LucideIcon } from "lucide-react";
import { isValidElement, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Button, ButtonLink } from "./button";

/**
 * The action a description form or an element takes.
 *
 * A descriptor rather than a bare `ReactNode` so that the button is built once,
 * here, instead of at every call site — and so that `onClick` and `href` cannot
 * both be forgotten. Passing arbitrary children still works for the cases that
 * genuinely need them (a split button, a form).
 */
export type EmptyStateAction =
  | ReactNode
  | { label: string; onClick?: () => void; href?: string };

type EmptyStateActionDescriptor = Extract<EmptyStateAction, { label: string }>;

/**
 * The state a screen is in when it has nothing to show.
 *
 * Empty states get written last and skipped most, which is why so many of them
 * are a shrug. This one has three parts and the reason for the third: what is
 * empty, why it might be empty, and the one action that fixes it. "No results"
 * is not a message, it is a symptom.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  /** Optional. An error state has nothing to illustrate, so the box is skipped. */
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: EmptyStateAction;
  className?: string;
  /** For an empty region inside an already-dense screen, not a whole page. */
  compact?: boolean;
}) {
  const renderedAction = renderAction(action, compact);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-16",
        className,
      )}
    >
      {Icon ? (
        <div
          aria-hidden="true"
          className={cn(
            "grid place-items-center rounded-lg border border-line bg-surface-sunken text-ink-400 dark:border-line dark:bg-surface-raised",
            compact ? "size-9" : "size-12",
          )}
        >
          <Icon className={compact ? "size-4" : "size-5"} strokeWidth={1.75} />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <p
          className={cn(
            "font-display font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50",
            compact ? "text-sm" : "text-md",
          )}
        >
          {title}
        </p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-ink-500 dark:text-ink-400">
            {description}
          </p>
        ) : null}
      </div>
      {renderedAction ? <div className="mt-1">{renderedAction}</div> : null}
    </div>
  );
}

function renderAction(action: EmptyStateAction, compact: boolean) {
  if (!action) return null;
  // Anything that is not a plain descriptor is rendered as given.
  if (!isActionDescriptor(action)) return action;
  if (action.href) {
    return (
      <ButtonLink href={action.href} size={compact ? "sm" : "md"}>
        {action.label}
      </ButtonLink>
    );
  }
  return (
    <Button size={compact ? "sm" : "md"} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

function isActionDescriptor(
  action: EmptyStateAction,
): action is EmptyStateActionDescriptor {
  return (
    typeof action === "object" &&
    action !== null &&
    !isValidElement(action) &&
    "label" in action
  );
}

/**
 * The empty table body.
 *
 * Rendered in place of rows, so a table with no data still has a table and its
 * headers still line up. Replacing the whole table with an EmptyState instead
 * removes the columns, and the user loses the map of what will appear there.
 */
export function EmptyTableRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        {children}
      </td>
    </tr>
  );
}
