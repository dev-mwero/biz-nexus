import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * The plain form label.
 *
 * There are two labels in this layer and the difference matters. `FieldLabel`
 * wires itself to a Base UI `Field.Root`, which is what composes
 * `aria-describedby` across hint and error and marks the control invalid.
 * `Label` is the standalone one, for the cases where there is no `Field` around
 * it — a filter bar, a dialog's lone reason input, a settings row.
 *
 * The typography is identical to `FieldLabel` on purpose. A label that reads
 * differently depending on which wrapper happened to be used is the kind of
 * inconsistency nobody notices until a form is half one and half the other.
 *
 * `htmlFor` is required in the type rather than optional. A label with no
 * association is not a label, it is a caption, and the type is the cheapest
 * place to say so — the alternative is discovering it from an audit. Wrapping
 * the control inside the label is equally valid HTML, but this layer keeps
 * controls and labels as siblings so a control can be reordered independently,
 * which is why the association is explicit here.
 */
export function Label({
  className,
  htmlFor,
  children,
  ...props
}: Omit<ComponentPropsWithoutRef<"label">, "htmlFor"> & {
  htmlFor: string;
}) {
  return (
    <label
      data-slot="label"
      htmlFor={htmlFor}
      className={cn(
        "text-sm font-medium text-ink-700 dark:text-ink-200",
        className,
      )}
      {...props}
    >
      {children}
    </label>
  );
}
