"use client";

import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { cn } from "@/shared/lib/cn";

/**
 * An identity chip.
 *
 * The circular crop and the neutral fill are not decoration: a square avatar
 * in a table of round ones is the single most visible sign that a screen was
 * assembled rather than designed.
 *
 * `imageLoadingStatus` drives the fallback. Base UI unmounts the image while
 * it is loading or after it errors, so the initials are what the user sees
 * during the fetch and the photo is what replaces them. The alternative —
 * rendering both and hiding the fallback — shows a photo-shaped hole in the
 * row for as long as the image takes.
 */
export function Avatar({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseAvatar.Root>) {
  return (
    <BaseAvatar.Root
      data-slot="avatar"
      className={cn(
        "relative inline-flex size-8 shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
        className,
      )}
      {...props}
    />
  );
}

export function AvatarImage({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseAvatar.Image>) {
  return (
    <BaseAvatar.Image
      data-slot="avatar-image"
      className={cn("size-full object-cover", className)}
      {...props}
    />
  );
}

/**
 * Initials, centred in the circle.
 *
 * The fill is `ink-100` rather than a brand colour so a column of avatars reads
 * as one texture instead of a row of competing accents — this is a supporting
 * identifier, not the thing being looked at.
 */
export function AvatarFallback({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseAvatar.Fallback>) {
  return (
    <BaseAvatar.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center bg-ink-100 text-2xs font-semibold text-ink-600",
        "uppercase dark:bg-ink-100 dark:text-ink-700",
        className,
      )}
      {...props}
    />
  );
}
