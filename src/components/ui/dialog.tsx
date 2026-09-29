"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "./button";

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseDialog.Popup>) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        className={cn(
          "fixed inset-0 bg-ink-900/40 backdrop-blur-[1px]",
          "transition-opacity duration-[var(--bn-duration-base)]",
          "data-starting-style:opacity-0 data-ending-style:opacity-0",
        )}
      />
      <div className="fixed inset-0 grid place-items-center overflow-y-auto p-4">
        <BaseDialog.Popup
          className={cn(
            "w-full max-w-lg rounded-lg border border-line bg-surface-raised shadow-lg",
            "transition-[opacity,transform] duration-[var(--bn-duration-base)] ease-[var(--bn-ease-out)]",
            "data-starting-style:scale-95 data-starting-style:opacity-0",
            "data-ending-style:scale-95 data-ending-style:opacity-0",
            "dark:border-line",
            className,
          )}
          {...props}
        >
          {children}
        </BaseDialog.Popup>
      </div>
    </BaseDialog.Portal>
  );
}

export function DialogHeader({
  className,
  ...props
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 border-b border-line px-5 py-4 dark:border-line",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The title is what a screen reader announces when the dialog opens, so it is
 * required rather than optional. The close button sits in the header row for
 * that reason and not for symmetry.
 */
export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseDialog.Title>) {
  return (
    <div className="flex items-start justify-between gap-4">
      <BaseDialog.Title
        className={cn(
          "font-display text-lg font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50",
          className,
        )}
        {...props}
      />
      <DialogClose
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Close dialog">
            <X aria-hidden="true" className="size-4" />
          </Button>
        }
      />
    </div>
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description
      className={cn("text-sm text-ink-500 dark:text-ink-400", className)}
      {...props}
    />
  );
}

export function DialogBody({
  className,
  ...props
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

/** Right-aligned by default: the confirming action follows the one it discards. */
export function DialogFooter({
  className,
  ...props
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-line px-5 py-3.5 sm:flex-row sm:justify-end dark:border-line",
        className,
      )}
      {...props}
    />
  );
}
