"use client";

import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "./button";

/**
 * AlertDialog is Dialog with one difference that matters: it has no dismiss
 * affordance. No close button, no backdrop click, no escape key.
 *
 * That is the entire point. A dialog used to confirm a destructive action must
 * not be dismissable by a stray click, because "dismiss" and "I did not mean
 * that" look identical to the user. Every control that is not the one they
 * wanted has to be removed rather than styled to be unobtrusive.
 */
export const AlertDialog = BaseAlertDialog.Root;
export const AlertDialogTrigger = BaseAlertDialog.Trigger;
export const AlertDialogClose = BaseAlertDialog.Close;

export function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseAlertDialog.Popup>) {
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop
        className={cn(
          "fixed inset-0 bg-ink-900/40",
          "transition-opacity duration-[var(--bn-duration-base)]",
          "data-starting-style:opacity-0 data-ending-style:opacity-0",
        )}
      />
      <div className="fixed inset-0 grid place-items-center overflow-y-auto p-4">
        <BaseAlertDialog.Popup
          className={cn(
            "w-full max-w-md rounded-lg border border-line bg-surface-raised shadow-lg",
            "transition-[opacity,transform] duration-[var(--bn-duration-base)] ease-[var(--bn-ease-out)]",
            "data-starting-style:scale-95 data-starting-style:opacity-0",
            "data-ending-style:scale-95 data-ending-style:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </BaseAlertDialog.Popup>
      </div>
    </BaseAlertDialog.Portal>
  );
}

export function AlertDialogHeader({
  className,
  ...props
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 px-5 pt-5", className)}
      {...props}
    />
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseAlertDialog.Title>) {
  return (
    <BaseAlertDialog.Title
      className={cn(
        "font-display text-md font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50",
        className,
      )}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseAlertDialog.Description>) {
  return (
    <BaseAlertDialog.Description
      className={cn("text-sm text-ink-500 dark:text-ink-400", className)}
      {...props}
    />
  );
}

export function AlertDialogBody({
  className,
  ...props
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function AlertDialogFooter({
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

/**
 * The standard confirm/cancel pair, with cancel as the default focus.
 *
 * Focus lands on cancel because the safe option should be the one a reflexive
 * Enter hits. Making the destructive action the default would mean the fastest
 * possible path to data loss.
 */
export function AlertDialogActions({
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  confirmLoading = false,
  ...props
}: {
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void;
  confirmLoading?: boolean;
} & Omit<React.ComponentPropsWithoutRef<"div">, "onConfirm">) {
  return (
    <AlertDialogFooter {...props}>
      <AlertDialogClose
        render={<Button variant="secondary">{cancelLabel}</Button>}
      />
      <Button
        variant={destructive ? "danger" : "primary"}
        onClick={onConfirm}
        loading={confirmLoading}
      >
        {confirmLabel}
      </Button>
    </AlertDialogFooter>
  );
}
