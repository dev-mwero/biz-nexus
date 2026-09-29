"use client";

import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export const DropdownMenu = BaseMenu.Root;
export const DropdownMenuTrigger = BaseMenu.Trigger;
export const DropdownMenuGroup = BaseMenu.Group;
export const DropdownMenuSeparator = BaseMenu.Separator;
export const DropdownMenuRadioGroup = BaseMenu.RadioGroup;

export function DropdownMenuContent({
  className,
  children,
  align = "start",
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseMenu.Popup> & {
  align?: "start" | "center" | "end";
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        className="z-50"
        align={align}
        // Collision handling is not a nicety: a menu opened near the bottom of
        // a short viewport is a menu the user cannot use.
        sideOffset={4}
        collisionPadding={8}
      >
        <BaseMenu.Popup
          className={cn(
            "min-w-[10rem] origin-[var(--transform-origin)] rounded-lg border border-line bg-surface-raised p-1 shadow-lg",
            "transition-[opacity,transform] duration-[var(--bn-duration-fast)] ease-[var(--bn-ease-out)]",
            "data-starting-style:scale-95 data-starting-style:opacity-0",
            "data-ending-style:scale-95 data-ending-style:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export const dropdownMenuItemVariants = {
  base: [
    "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-ink-700 select-none",
    "data-highlighted:bg-surface-hover data-highlighted:text-ink-900",
    "dark:text-ink-200 dark:data-highlighted:bg-ink-700 dark:data-highlighted:text-ink-50",
    // A menu item that can be disabled has to look it, not just refuse clicks.
    "data-disabled:pointer-events-none data-disabled:opacity-45",
    "outline-none",
  ],
  danger:
    "text-critical data-highlighted:bg-critical-surface data-highlighted:text-critical",
} as const;

export function DropdownMenuItem({
  className,
  destructive = false,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseMenu.Item> & {
  destructive?: boolean;
}) {
  return (
    <BaseMenu.Item
      className={cn(
        dropdownMenuItemVariants.base,
        destructive && dropdownMenuItemVariants.danger,
        className,
      )}
      {...props}
    />
  );
}

/**
 * A checkable row.
 *
 * The indicator column is a fixed width so the labels of checkable and
 * non-checkable items stay aligned in the same menu. Without it, adding a
 * checkmark to one item shifts every label below it.
 */
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseMenu.CheckboxItem>) {
  return (
    <BaseMenu.CheckboxItem
      className={cn(dropdownMenuItemVariants.base, "pr-2", className)}
      {...props}
    >
      <span className="flex w-4 justify-center">
        <BaseMenu.CheckboxItemIndicator>
          <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
        </BaseMenu.CheckboxItemIndicator>
      </span>
      {children}
    </BaseMenu.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseMenu.RadioItem>) {
  return (
    <BaseMenu.RadioItem
      className={cn(dropdownMenuItemVariants.base, "pr-2", className)}
      {...props}
    >
      <span className="flex w-4 justify-center">
        <BaseMenu.RadioItemIndicator>
          <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
        </BaseMenu.RadioItemIndicator>
      </span>
      {children}
    </BaseMenu.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: {
  className?: string;
  children: ReactNode;
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
