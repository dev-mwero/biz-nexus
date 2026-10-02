"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { FormAlert, readErrorPayload, toFormError } from "@/components/auth";
import {
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@/components/ui";

/**
 * Request a password reset link.
 *
 * The endpoint always answers 200. The confirmation shown is the same whether
 * the address has an account or not: "If that address has an account, we've sent
 * a reset link." That neutrality is the reason the response cannot be anything
 * else — if it varied, this form would be an oracle that maps email addresses to
 * whether they exist.
 *
 * No timeout is shown, no "did you get the email?" dance. The most helpful
 * thing to do is point the visitor back to sign-in, because many people ask to
 * reset only after mistyping the email in the first place.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELDS = ["email"] as const;

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    setFieldError(null);
    setFormError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFieldError("Enter your email address.");
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setFieldError("Enter a valid email address.");
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });

      // A 422 here is the schema refusing the address's *shape*, never its
      // existence, so its `details` say nothing about whether the account is
      // real and can be shown on the field. Everything else — including a 500 —
      // still gets the neutral confirmation, because "we could not process this"
      // and "no such account" have to look identical to a caller.
      if (!response.ok && response.status === 422) {
        const failure = toFormError(await readErrorPayload(response), FIELDS);
        if (failure.fields.email) {
          setFieldError(failure.fields.email);
          return;
        }
      }

      setSent(true);
    } catch {
      setFormError("Could not reach the server. Check your connection.");
    } finally {
      setPending(false);
    }
  };

  if (sent) {
    return (
      <Card variant="outlined">
        <CardHeader>
          <h1 className="font-display text-md font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
            Check your email
          </h1>
          <CardDescription>
            If that address has an account, we&apos;ve sent a reset link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            If you don&apos;t see it, check your spam folder or try again in a
            moment.
          </p>
        </CardContent>
        <CardFooter>
          <ButtonLink href="/sign-in" variant="secondary" className="w-full">
            Back to sign in
          </ButtonLink>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardHeader>
        <h1 className="font-display text-md font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
          Forgot your password?
        </h1>
        <CardDescription>
          We&apos;ll send a reset link to your email.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <FormAlert message={formError} />

          <Field error={fieldError ?? undefined} required>
            <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
            <Input
              id="forgot-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={fieldError ? "true" : undefined}
              placeholder="you@company.com"
            />
            <FieldError>{fieldError}</FieldError>
          </Field>
        </CardContent>

        <CardFooter className="flex-col gap-3">
          <Button type="submit" loading={pending} className="w-full">
            Send reset link
          </Button>
          <p className="text-center text-sm text-ink-500 dark:text-ink-400">
            <Link
              href="/sign-in"
              className="text-ink-900 underline underline-offset-4 dark:text-ink-50"
            >
              Back to sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
