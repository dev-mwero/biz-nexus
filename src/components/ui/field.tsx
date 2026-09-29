"use client";

import { Field as BaseField } from "@base-ui/react/field";
import { createContext, type ReactNode, useContext } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Field is the reason these primitives exist as a group rather than as
 * independent pieces.
 *
 * The hard part of a form control is not the box, it is the wiring: the label
 * must be programmatically associated, the hint and the error must both be
 * announced, and the control's invalid state must be reflected in the
 * accessibility tree rather than only in a border colour. Every one of those is
 * easy to get subtly wrong and impossible to notice by looking at the screen.
 *
 * Base UI's `Field.Root` does that wiring, including composing
 * `aria-describedby` across hint and error, and it composes with React Hook
 * Form via its `errors` prop. This module is the presentation layer over it and
 * owns two decisions the library leaves open: where the label sits relative to
 * the control, and how an error reserves its space.
 */

interface FieldContextValue {
  error?: string;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue>({ required: false });

export function useField(): FieldContextValue {
  return useContext(FieldContext);
}

export type FieldProps = {
  children: ReactNode;
  /** The validation message. Its presence is what marks the control invalid. */
  error?: string;
  required?: boolean;
  className?: string;
};

/**
 * `reserveSpace` defaults to true because a form whose error message shoves
 * every field below it down a line is a form that reflows under the user at the
 * worst moment — exactly when they are trying to read what went wrong. The cost
 * is a permanently empty line under a field, which is a cheap trade.
 */
export function Field({
  children,
  error,
  required = false,
  className,
}: FieldProps) {
  return (
    <FieldContext.Provider value={{ error, required }}>
      <BaseField.Root
        invalid={error ? true : undefined}
        className={cn("flex flex-col gap-1.5", className)}
      >
        {children}
      </BaseField.Root>
    </FieldContext.Provider>
  );
}

export function FieldLabel({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseField.Label>) {
  const { required } = useField();

  return (
    <BaseField.Label
      className={cn(
        "text-sm font-medium text-ink-700 dark:text-ink-200",
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <>
          <span aria-hidden="true" className="ml-0.5 text-critical">
            *
          </span>
          {/* Announced, so a screen reader is not left guessing whether the
              visible asterisk is decoration or a requirement. */}
          <span className="sr-only"> (required)</span>
        </>
      ) : null}
    </BaseField.Label>
  );
}

export type FieldHintProps = React.ComponentPropsWithoutRef<
  typeof BaseField.Description
>;

export function FieldHint({ className, ...props }: FieldHintProps) {
  return (
    <BaseField.Description
      className={cn("text-xs text-ink-500 dark:text-ink-400", className)}
      {...props}
    />
  );
}

export function FieldError({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseField.Error>) {
  return (
    <BaseField.Error
      className={cn(
        "min-h-4 text-xs font-medium text-critical dark:text-critical",
        className,
      )}
      {...props}
    >
      {children}
    </BaseField.Error>
  );
}

/**
 * Convenience wrapper for the common single-control case.
 *
 * Passing `error` to `Field` is what turns the control red: the invalid state
 * comes from one prop, so a field cannot be rendered red without also
 * announcing itself as invalid.
 */
export function FieldGroup({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Field error={error} required={required} className={className}>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {hint ? <FieldHint>{hint}</FieldHint> : null}
      <FieldError>{error}</FieldError>
    </Field>
  );
}
