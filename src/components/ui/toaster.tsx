"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toasts.
 *
 * `richColors` is deliberately off. This design reserves colour for data
 * meaning, and a system-coloured toast would be the one element on screen
 * whose colour does not encode state. Tone is carried by the message instead.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group border border-line bg-surface-raised text-ink-700 shadow-lg rounded-lg text-sm",
          description: "text-ink-500",
          actionButton:
            "bg-ink-900 text-ink-50 rounded-sm text-xs font-medium px-2 py-1",
          cancelButton: "bg-ink-100 text-ink-600 rounded-sm text-xs",
          success: "border-positive-border",
          error: "border-critical-border",
        },
      }}
      {...props}
    />
  );
}
