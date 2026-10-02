"use client";

import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cn } from "@/shared/lib/cn";

/**
 * A tabbed region.
 *
 * The tab strip is a `Badge`-weight outline row rather than underlined tabs.
 * Underline is the convention that breaks here: it implies a document, and this
 * product's detail views switch between records and their history, not between
 * parts of one document.
 *
 * `activateOnFocus` is off. Arrow keys move focus between tabs without
 * selecting them, and <kbd>Enter</kbd> or <kbd>Space</kbd> selects. Selection
 * following focus would make it impossible to move along the strip to read the
 * labels without changing what is on screen — which is a data fetch, a
 * re-render, and a scroll jump, on a detail page the user is trying to read.
 */
export function Tabs({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseTabs.Root>) {
  return (
    <BaseTabs.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex items-center gap-1 border-b border-line dark:border-line",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      data-slot="tabs-trigger"
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 rounded-t-md border border-transparent px-3 py-2",
        "text-sm font-medium text-ink-500 transition-colors select-none",
        "hover:text-ink-900 dark:hover:text-ink-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900",
        "dark:focus-visible:outline-ink-50",
        // The active tab is the only one carrying weight, and the indicator sits
        // on its bottom edge where the strip's own border is, so nothing reflows.
        "data-selected:border-line data-selected:bg-surface data-selected:text-ink-900",
        "dark:data-selected:border-line dark:data-selected:bg-surface-raised dark:data-selected:text-ink-50",
        "data-disabled:pointer-events-none data-disabled:opacity-45",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseTabs.Panel>) {
  return (
    <BaseTabs.Panel
      data-slot="tabs-content"
      className={cn(
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900",
        "dark:focus-visible:outline-ink-50",
        className,
      )}
      {...props}
    />
  );
}
