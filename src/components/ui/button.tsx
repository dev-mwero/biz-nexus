"use client";

import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/shared/lib/cn";
import { Spinner } from "./spinner";

/**
 * The action vocabulary.
 *
 * `primary` is ink, not blue. This is a ledger: a screen with eight coloured
 * primary buttons reads as a toy, and colour in this system is reserved for
 * status. Primary is the single strongest ink on the surface, so "where do I
 * click" is answered by weight rather than by hue.
 *
 * `danger` is the one variant that takes chroma, because a destructive action
 * that looks like every other action is a data-loss bug waiting to happen.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md font-medium transition-[background-color,border-color,color,box-shadow]",
    "duration-[var(--bn-duration-fast)] ease-[var(--bn-ease-out)]",
    "disabled:pointer-events-none disabled:opacity-45",
    // A single focus treatment everywhere, on the ring rather than the box, so
    // it reads clearly against both the surface and an inverted button.
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900",
    "dark:focus-visible:outline-ink-50",
  ],
  {
    variants: {
      variant: {
        // Primary inverts in dark mode: a dark button with light text. It stays
        // the heaviest element on the screen in both modes, which is the only
        // job it has.
        primary:
          "bg-ink-900 text-white shadow-sm hover:bg-ink-800 active:bg-ink-800 dark:bg-ink-50 dark:text-ink-900 dark:hover:bg-white dark:active:bg-white",
        // Secondary deliberately has no dark override. The surface and ink
        // tokens already invert, and a light-filled secondary would compete
        // with the primary for weight instead of sitting beneath it.
        secondary:
          "border border-line-strong bg-surface text-ink-800 shadow-sm hover:bg-surface-hover active:bg-surface-active",
        ghost:
          "text-ink-700 hover:bg-surface-hover active:bg-surface-active dark:text-ink-200 dark:hover:bg-surface-hover dark:active:bg-surface-active",
        danger:
          "bg-critical text-white shadow-sm hover:brightness-110 active:brightness-95",
        link: "h-auto text-ink-700 underline-offset-4 hover:underline dark:text-ink-200",
      },
      size: {
        // 32px is the floor that still meets a pointer target, and this is a
        // tool used with a mouse for eight hours a day.
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-3.5 text-sm",
        lg: "h-11 px-5 text-base",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ComponentPropsWithoutRef<"button"> &
  VariantProps<typeof buttonVariants> & { loading?: boolean };

/**
 * Loading keeps the label in the DOM rather than replacing it.
 *
 * Removing the label resizes the button, which reflows the row it sits in and
 * moves the controls beside it. Hiding the label's text and overlaying the
 * spinner holds the button's width, so a submit in flight does not shove the
 * cancel button sideways.
 *
 * The accessible name therefore survives the transition, and `aria-busy` is
 * what conveys the state. The spinner is decorative — a second announcement on
 * top of `aria-busy` would say "loading" twice.
 */
export function Button({
  className,
  variant,
  size,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      data-slot="button"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <Spinner className="absolute" /> : null}
      <span
        className={cn("inline-flex items-center gap-2", loading && "invisible")}
      >
        {children}
      </span>
    </button>
  );
}

/**
 * A button whose content is a single glyph.
 *
 * This is a wrapper rather than `size: "icon"` on `Button` for one reason: an
 * icon button has no visible text, so it has no accessible name unless one is
 * supplied, and nothing in the styling can supply it for you. Naming it
 * separately makes `aria-label` the first thing you look for when you reach for
 * it, in the same way a separate `Icon` name does.
 *
 * `variant` is `Button`'s, unchanged. `size` accepts `Button`'s full size union
 * so a call site can move between the two without retuning it, and the square
 * dimension comes from `ICON_BUTTON_SIZES` rather than from the text sizes —
 * `sm` on a text button is `h-8 px-3`, which is not square and cannot hold a
 * glyph on its optical centre. Defaulting to `icon` rather than `md` keeps the
 * common case from having to ask.
 *
 * `loading` still holds the button's width, so a row of action buttons in a
 * table's row-actions cell does not reflow mid-flight.
 */
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

const ICON_BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "size-8",
  md: "size-9",
  lg: "size-11",
  icon: "size-9",
  "icon-sm": "size-8",
};

export function IconButton({
  className,
  variant,
  size = "icon",
  loading = false,
  disabled,
  children,
  ...props
}: Omit<ButtonProps, "size"> & { size?: ButtonSize }) {
  return (
    <button
      type="button"
      data-slot="icon-button"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        buttonVariants({ variant, size }),
        // Width is forced square and padding is dropped, so a text size that
        // carries horizontal padding cannot make the button oblong.
        ICON_BUTTON_SIZES[size ?? "icon"],
        "px-0",
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="absolute" /> : null}
      <span
        className={cn("inline-flex items-center gap-2", loading && "invisible")}
      >
        {children}
      </span>
    </button>
  );
}

type ButtonLinkProps = ComponentPropsWithoutRef<typeof Link> &
  VariantProps<typeof buttonVariants>;

/** A link that looks like a button. Extends `Link`, so it prefetches and works as a real anchor. */
export function ButtonLink({
  className,
  variant,
  size,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      data-slot="button-link"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
