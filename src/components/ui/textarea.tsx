import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/shared/lib/cn";
import { controlVariants } from "./control";

export type TextareaProps = ComponentPropsWithoutRef<"textarea"> & {
  /** Grows with content up to a cap instead of scrolling at three rows. */
  autoResize?: boolean;
};

export function Textarea({
  className,
  rows = 3,
  autoResize,
  ...props
}: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(
        controlVariants,
        "resize-y px-3 py-2 leading-relaxed",
        autoResize && "field-sizing-content min-h-20 max-h-96",
        className,
      )}
      {...props}
    />
  );
}
