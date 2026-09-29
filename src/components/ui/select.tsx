"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { controlVariants } from "./control";

export const Select = BaseSelect.Root;
export const SelectGroup = BaseSelect.Group;

export function SelectValue(
  props?: React.ComponentPropsWithoutRef<typeof BaseSelect.Value>,
) {
  return <BaseSelect.Value {...props} />;
}

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger>) {
  return (
    <BaseSelect.Trigger
      className={cn(
        controlVariants,
        // justify-between puts the chevron at the trailing edge and lets long
        // values ellipsis rather than pushing the icon off the control.
        "flex h-9 items-center justify-between gap-2 text-left data-[placeholder]:text-ink-400",
        className,
      )}
      {...props}
    >
      <span className="truncate">{children ?? <BaseSelect.Value />}</span>
      <BaseSelect.Icon className="shrink-0 text-ink-400">
        <ChevronDown aria-hidden="true" className="size-4" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSelect.Popup>) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        className="z-50"
        sideOffset={4}
        collisionPadding={8}
      >
        <BaseSelect.Popup
          className={cn(
            "max-h-[min(20rem,var(--available-height))] min-w-[var(--anchor-width)] origin-[var(--transform-origin)]",
            "overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface-raised p-1 shadow-lg",
            "transition-[opacity,transform] duration-[var(--bn-duration-fast)] ease-[var(--bn-ease-out)]",
            "data-starting-style:scale-95 data-starting-style:opacity-0",
            "data-ending-style:scale-95 data-ending-style:opacity-0",
            className,
          )}
          {...props}
        >
          <BaseSelect.List>{children}</BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

/**
 * Fixed indicator column, for the same reason as in DropdownMenuCheckboxItem:
 * selected-state markers must not reflow the labels around them.
 */
export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSelect.Item>) {
  return (
    <BaseSelect.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-2 text-sm text-ink-700 select-none",
        "data-highlighted:bg-surface-hover data-highlighted:text-ink-900",
        "dark:text-ink-200 dark:data-highlighted:bg-ink-700 dark:data-highlighted:text-ink-50",
        "data-disabled:pointer-events-none data-disabled:opacity-45",
        "outline-none",
        className,
      )}
      {...props}
    >
      <span className="flex w-4 justify-center">
        <BaseSelect.ItemIndicator>
          <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
        </BaseSelect.ItemIndicator>
      </span>
      <BaseSelect.ItemText className="truncate">{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
}

export function SelectLabel({
  className,
  ...props
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "px-2 py-1.5 text-2xs font-semibold tracking-[0.06em] text-ink-400 uppercase dark:text-ink-500",
        className,
      )}
      {...props}
    />
  );
}

export function SelectSeparator({ className }: { className?: string }) {
  return (
    <div className={cn("my-1 h-px bg-line dark:bg-line-strong", className)} />
  );
}
