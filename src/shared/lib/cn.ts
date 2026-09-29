import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, resolving Tailwind conflicts by last-wins.
 *
 * The conflict resolution is the point. `cn("p-2", "p-4")` must be `p-4`, not
 * `"p-2 p-4"` — without twMerge the result depends on stylesheet order, which
 * makes a component's override silently stop working the moment someone edits
 * a stylesheet. Components rely on this: a caller passing `className` to a
 * Button is expected to be able to change its padding.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
