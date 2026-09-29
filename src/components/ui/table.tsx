import { cn } from "@/shared/lib/cn";

/**
 * Data table.
 *
 * A styled `<table>` rather than a grid of divs. The temptation with dense
 * dashboards is `display: grid`, because it makes cells easy to align, but it
 * throws away the semantics that let a screen reader announce a row as a row
 * and let the browser's own column resizing work. Nothing here is worth that.
 *
 * Density is the design constraint. `md` is the default rather than a variant
 * because `md` is the one this product is for; a roomy table is the wrong
 * default for a tool, and a variant that nobody selects is dead code.
 */
export function Table({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"thead">) {
  return (
    <thead
      className={cn(
        "border-b border-line bg-surface-sunken dark:border-line dark:bg-surface-raised",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"tbody">) {
  return (
    <tbody
      className={cn("divide-y divide-line dark:divide-line", className)}
      {...props}
    />
  );
}

export function TableRow({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"tr">) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-surface-hover dark:hover:bg-surface-hover",
        "data-[selected]:bg-surface-active dark:data-[selected]:bg-ink-700",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"th">) {
  return (
    <th
      className={cn(
        "h-9 px-3 text-left align-middle text-xs font-semibold tracking-[0.02em] text-ink-500",
        "uppercase dark:text-ink-400",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"td">) {
  return (
    <td
      className={cn(
        "px-3 py-2 align-middle text-ink-700 dark:text-ink-200",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A numeric cell.
 *
 * The mono font and `tabular-nums` are not decoration. In a column of money or
 * counts, proportional digits have different widths, so the decimal points do
 * not line up and the eye cannot scan the column. Tabular figures fix that, and
 * this class is applied wherever a number appears rather than left to each call
 * site.
 */
export function TableNumberCell({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"td">) {
  return (
    <td
      className={cn(
        "px-3 py-2 text-right align-middle font-mono text-sm tabular-nums text-ink-900 dark:text-ink-50",
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"caption">) {
  return (
    <caption
      className={cn("p-3 text-xs text-ink-500 dark:text-ink-400", className)}
      {...props}
    />
  );
}
