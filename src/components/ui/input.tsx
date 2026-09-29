import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/shared/lib/cn";
import { controlVariants } from "./control";

export type InputProps = ComponentPropsWithoutRef<"input">;

export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(controlVariants, "h-9 px-3", className)}
      {...props}
    />
  );
}
