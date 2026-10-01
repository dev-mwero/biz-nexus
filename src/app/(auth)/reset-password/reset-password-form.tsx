"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
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
  FieldHint,
  FieldLabel,
  Input,
} from "@/components/ui";

/**
 * Set a new password from a reset link.
 *
 * The token arrives in `?token=`. It is not rendered as a field: it is not the
 * visitor's to edit, and an input they could change would only ever be a way to
 * submit a token the server had already refused.
 *
 * Every redemption failure is the same `TOKEN_NOT_REDEEMABLE` — expired, spent,
 * or invented — and this page does not attempt to tell them apart. It sends the
 * visitor back to request a new link, which is the only action that can succeed
 * in any of those cases.
 *
 * Two password fields because this is the one form where a typo has no other
 * consequence until much later: a mistyped new password locks the account out of
 * its own account. The match is checked here because the server has no way to
 * know the intent behind the second field.
 */

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 200;

const FIELDS = ["password"] as const;

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    setFieldErrors({});
    setFormError(null);

    const nextErrors: Record<string, string> = {};
    if (!password) nextErrors.password = "Choose a password.";
    else if (password.length < PASSWORD_MIN)
      nextErrors.password = `Use at least ${PASSWORD_MIN} characters.`;
    else if (password.length > PASSWORD_MAX)
      nextErrors.password = `Use at most ${PASSWORD_MAX} characters.`;
    if (confirmPassword !== password)
      nextErrors.confirmPassword = "Passwords do not match.";

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (!response.ok) {
        // A 422's `details` are the schema complaining about the password the
        // visitor just typed, so those belong on the field. Everything else is an
        // unusable link, and the endpoint deliberately reports expired, spent and
        // never-existed tokens identically, so one message covers all three.
        const failure = toFormError(await readErrorPayload(response), FIELDS);

        if (Object.keys(failure.fields).length > 0) {
          setFieldErrors(failure.fields);
          return;
        }

        setFormError(
          failure.form ??
            "This reset link is no longer valid. Request a new one.",
        );
        return;
      }

      toast.success("Password updated. Sign in with your new password.");
      router.push("/sign-in");
    } catch {
      setFormError("Could not reach the server. Check your connection.");
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <Card variant="outlined">
        <CardHeader>
          <h1 className="font-display text-md font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
            Link not valid
          </h1>
          <CardDescription>
            This page needs a reset link. If you followed one, the link is
            incomplete.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <ButtonLink
            href="/forgot-password"
            variant="secondary"
            className="w-full"
          >
            Request a new link
          </ButtonLink>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardHeader>
        <h1 className="font-display text-md font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
          Choose a new password
        </h1>
        <CardDescription>
          Setting a new password signs you out everywhere.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <FormAlert message={formError} />

          <Field error={fieldErrors.password} required>
            <FieldLabel htmlFor="reset-password">New password</FieldLabel>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={fieldErrors.password ? "true" : undefined}
            />
            <FieldHint>At least {PASSWORD_MIN} characters.</FieldHint>
            <FieldError>{fieldErrors.password}</FieldError>
          </Field>

          <Field error={fieldErrors.confirmPassword} required>
            <FieldLabel htmlFor="reset-confirm">
              Confirm new password
            </FieldLabel>
            <Input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={fieldErrors.confirmPassword ? "true" : undefined}
            />
            <FieldError>{fieldErrors.confirmPassword}</FieldError>
          </Field>
        </CardContent>

        <CardFooter className="flex-col gap-3">
          <Button type="submit" loading={pending} className="w-full">
            Update password
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
