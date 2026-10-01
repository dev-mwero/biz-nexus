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
 * The dismissing button.
 *
 * It is a `Button` rendered *as* the close trigger rather than a button with a
 * click handler, so closing the dialog is the same gesture for a mouse, for
 * <kbd>Enter</kbd>, and for the initial focus that lands here.
 */
export function AlertDialogCancel({
  className,
  children,
  ...props
}: {
  className?: string;
  children?: ReactNode;
} & React.ComponentPropsWithoutRef<typeof Button>) {
  return (
    <AlertDialogClose
      render={
        <Button variant="secondary" className={className} {...props}>
          {children}
        </Button>
      }
    />
  );
}

/**
 * The committing button.
 *
 * Closes the dialog as part of committing, because a confirm that leaves the
 * dialog open behind a result the user can already see is a dialog they have to
 * dismiss twice. Default focus never lands here — see `AlertDialogActions`.
 *
 * `onConfirm` and `confirmLoading` are accepted alongside the plain button props
 * so that the two ways of composing this dialog cannot drift: a caller who
 * supplies `onConfirm` gets the same loading treatment as one who supplies
 * `confirmLoading` on the fixed pair, rather than having to reimplement the
 * in-flight button to get it. `onConfirm` may be async; the dialog is closed by
 * the trigger regardless, and the handler owns reporting failure.
 */
export function AlertDialogAction({
  className,
  children,
  variant,
  destructive = false,
  onConfirm,
  confirmLoading = false,
  onClick,
  ...props
}: {
  children?: ReactNode;
  destructive?: boolean;
  onConfirm?: () => void;
  confirmLoading?: boolean;
} & React.ComponentPropsWithoutRef<typeof Button>) {
  return (
    <AlertDialogClose
      render={
        <Button
          variant={variant ?? (destructive ? "danger" : "primary")}
          className={className}
          loading={confirmLoading}
          onClick={onClick ?? onConfirm}
          {...props}
        >
          {children}
        </Button>
      }
    />
  );
}

/**
 * The standard confirm/cancel pair, with cancel as the default focus.
 *
 * Focus lands on cancel because the safe option should be the one a reflexive
 * Enter hits. Making the destructive action the default would mean the fastest
 * possible path to data loss.
 *
 * Both forms are supported. Pass labels for the fixed pair, or pass children to
 * compose the buttons yourself when the confirm needs its own affordance — a
 * second field, a checkbox, an in-flight state the button alone cannot express.
 * The composition form takes `Cancel` and `Confirm` as statics so a caller
 * assembling their own footer does not have to import two more names for
 * something that is conceptually one thing.
 */
export function AlertDialogActions({
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  confirmLoading = false,
  children,
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
      {children ?? (
        <>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            destructive={destructive}
            onConfirm={onConfirm}
            confirmLoading={confirmLoading}
          >
            {confirmLabel}
          </AlertDialogAction>
        </>
      )}
    </AlertDialogFooter>
  );
}

AlertDialogActions.Cancel = AlertDialogCancel;
AlertDialogActions.Confirm = AlertDialogAction;
