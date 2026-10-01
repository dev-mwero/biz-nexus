"use client";

/**
 * The form-level error banner.
 *
 * It carries `aria-live="polite"` because it appears in response to a submit the
 * visitor just took, and a message that only exists visually is a message a
 * screen reader user is never told. Polite rather than assertive: a failed
 * submit is not an emergency, and interrupting whatever is being read to
 * announce "wrong password" unhelpfully cuts into the field that has it.
 *
 * `role="alert"` is deliberately absent. The live region is what announces it,
 * and a region that is both an alert and a live region is announced twice by
 * some screen readers and once by others.
 */
export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <p
      aria-live="polite"
      className="rounded-md border border-critical-border bg-critical-surface px-3 py-2 text-sm text-critical"
    >
      {message}
    </p>
  );
}
