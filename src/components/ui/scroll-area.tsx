"use client";

import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import { cn } from "@/shared/lib/cn";

/**
 * A scroll container that does not repaint its own scrollbar.
 *
 * The native scrollbar on a scrolling region inside a card is the reason this
 * primitive exists at all: it is either invisible, twelve pixels wide, or a
 * themed overlay that changes the region's width the moment it appears. That
 * last behaviour — a layout shift on first scroll — is the specific problem,
 * because the column of data the user is about to read is what moves.
 *
 * The scrollbar here is absolutely positioned over the content, so the
 * viewport's width is fixed whether or not it is scrollable. The thumb is an
 * `ink-300` rail that only takes colour while the region is being scrolled or
 * hovered: a permanently visible thumb on every static region on a dashboard
 * is noise that says "scrollable" about things that are not.
 *
 * Both axes are handled by the same rail, and the horizontal one is only
 * rendered if the content actually overflows on that axis. An always-present
 * horizontal rail on a list is a false promise.
 */
export function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseScrollArea.Root>) {
  return (
    <BaseScrollArea.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <BaseScrollArea.Viewport
        data-slot="scroll-area-viewport"
        className="size-full overscroll-contain rounded-[inherit] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900 dark:focus-visible:outline-ink-50"
      >
        {children}
      </BaseScrollArea.Viewport>
      {/* The vertical rail is always mounted: on a short page it is simply
          hidden by the root's overflow state, and keeping it mounted avoids a
          layout pass when the content grows past the cap. */}
      <BaseScrollArea.Scrollbar
        orientation="vertical"
        className={cn(
          "flex w-2 touch-none select-none rounded-full bg-transparent p-0.5",
          "opacity-0 transition-opacity duration-[var(--bn-duration-base)]",
          "data-hovering:opacity-100 data-scrolling:opacity-100",
        )}
      >
        <BaseScrollArea.Thumb className="flex-1 rounded-full bg-ink-300 dark:bg-ink-500" />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Scrollbar
        orientation="horizontal"
        className={cn(
          "flex h-2 touch-none select-none rounded-full bg-transparent p-0.5",
          "opacity-0 transition-opacity duration-[var(--bn-duration-base)]",
          "data-hovering:opacity-100 data-scrolling:opacity-100",
        )}
      >
        <BaseScrollArea.Thumb className="flex-1 rounded-full bg-ink-300 dark:bg-ink-500" />
      </BaseScrollArea.Scrollbar>
    </BaseScrollArea.Root>
  );
}
