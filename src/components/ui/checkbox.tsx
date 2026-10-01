"use client";

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/shared/lib/cn";

/**
 * A tick box.
 *
 * Built on Base UI's `Checkbox.Root`, which renders a `role="checkbox"`
 * element with a hidden `<input>` beside it. That pairing is the point: the
 * span carries the role and the keyboard handling, and the input is what a form
 * submission actually reads. A styled `<div role="checkbox">` with a click
 * handler looks identical and is silently absent from every non-JS path.
 *
 * Keyboard behaviour is the library's, not reimplemented here. Space toggles
 * because the element has the checkbox role, which means a checkbox in a table
 * of 200 rows is reachable without a custom key handler that has to be
 * re-audited every time someone adds a shortcut.
 *
 * Accessibility requires a name, and this component does not invent one. Pass
 * `aria-label` when there is no visible `<Label>` wired to it with `htmlFor` —
 * a bare box next to a heading is not labelled by that heading, because
 * proximity is not association.
 */
export function Checkbox({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseCheckbox.Root>) {
  return (
    <BaseCheckbox.Root
      data-slot="checkbox"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-xs border border-line-strong bg-surface",
        "transition-[background-color,border-color,box-shadow] duration-[var(--bn-duration-fast)]",
        "hover:border-ink-600 dark:hover:border-ink-400",
        // Ink when checked, not a brand colour: this is a confirmation of state,
        // and the row it sits in carries the meaning.
        "data-checked:border-ink-900 data-checked:bg-ink-900 data-checked:text-white",
        "data-indeterminate:border-ink-900 data-indeterminate:bg-ink-900 data-indeterminate:text-white",
        "dark:data-checked:border-ink-50 dark:data-checked:bg-ink-50 dark:data-checked:text-ink-900",
        "dark:data-indeterminate:border-ink-50 dark:data-indeterminate:bg-ink-50 dark:data-indeterminate:text-ink-900",
        "data-disabled:pointer-events-none data-disabled:opacity-45",
        "data-readonly:pointer-events-none",
        // A filled focus state for the same reason controls use one: the ring is
        // inside the box, so it cannot be mistaken for a validation border.
        "outline-none data-focused:ring-2 data-focused:ring-ink-900/15",
        "dark:data-focused:ring-ink-100/20",
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator
        // Kept mounted so the two glyphs can cross-fade; unmounting on every
        // toggle flashes the border colour through.
        keepMounted
        className="flex items-center justify-center text-current"
      >
        <Check
          aria-hidden="true"
          className="size-3 data-checked:block data-unchecked:hidden"
          strokeWidth={3}
        />
        <Minus
          aria-hidden="true"
          className="size-3 data-indeterminate:block data-checked:hidden data-unchecked:hidden"
          strokeWidth={3}
        />
      </BaseCheckbox.Indicator>
      {children}
    </BaseCheckbox.Root>
  );
}
