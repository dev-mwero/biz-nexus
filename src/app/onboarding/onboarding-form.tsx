"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { FormAlert, readErrorPayload, toFormError } from "@/components/auth";
import {
  Button,
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
  Spinner,
} from "@/components/ui";
import { useSession } from "@/shared/auth/session-client";

/**
 * First run: name the organisation.
 *
 * A new account has a user and no organisation, which is a real state rather
 * than an error — the API describes it with `activeOrganizationId: null` and an
 * empty permission list instead of refusing. Every screen behind the shell needs
 * an active organisation to query at all, so this page sits between the two.
 *
 * `/me` is read on mount to answer two questions before showing the form: is
 * there a session at all, and has this account already been onboarded? A refusal
 * sends the visitor to sign-in; an account that already has an active
 * organisation has no business here and goes to the dashboard. Both use `replace`
 * so the back button does not walk into a page that immediately redirects again.
 *
 * The form itself is deliberately one field. An organisation needs a name and
 * nothing else the visitor has an opinion about — timezone, currency and the
 * rest are settings they can change later, and asking for them here would mean
 * choosing a locale on their behalf before they had seen one.
 */

const NAME_MAX = 120;

const FIELDS = ["name"] as const;

type Phase = "checking" | "ready" | "redirecting";

export function OnboardingForm() {
  const router = useRouter();
  const { data, loading, refresh } = useSession();

  const [name, setName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<Phase>("checking");

  // The session provider has answered. `data` null with loading finished means
  // `/me` refused, which is the only way to be unauthenticated here.
  useEffect(() => {
    if (loading) return;

    if (data === null) {
      setPhase("redirecting");
      router.replace("/sign-in");
      return;
    }

    if (data.activeOrganizationId) {
      setPhase("redirecting");
      router.replace("/dashboard");
      return;
    }

    setPhase("ready");
  }, [loading, data, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    setFieldErrors({});
    setFormError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFieldErrors({ name: "Enter a name." });
      return;
    }
    if (trimmedName.length > NAME_MAX) {
      setFieldErrors({ name: `Use at most ${NAME_MAX} characters.` });
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/v1/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      });

      if (!response.ok) {
        const failure = toFormError(await readErrorPayload(response), FIELDS);
        setFieldErrors(failure.fields);
        setFormError(failure.form);
        return;
      }

      // The endpoint makes the new organisation the active one in the same
      // transaction that creates it, so the session the shell will read already
      // points at it and no second call is needed to select it.
      await refresh();
      router.push("/dashboard");
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Check your connection.");
    } finally {
      setPending(false);
    }
  };

  if (phase === "checking") {
    return (
      <Card variant="outlined" aria-busy="true">
        <CardHeader>
          <h1 className="font-display text-md font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
            Name your workspace
          </h1>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-ink-500 dark:text-ink-400">
          <Spinner size="sm" label="Checking your account" />
          Checking your account…
        </CardContent>
      </Card>
    );
  }

  if (phase === "redirecting") {
    return (
      <Card variant="outlined" aria-busy="true">
        <CardContent className="flex items-center gap-2 text-sm text-ink-500 dark:text-ink-400">
          <Spinner size="sm" label="Redirecting" />
          Taking you to your dashboard…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardHeader>
        <h1 className="font-display text-md font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
          Name your workspace
        </h1>
        <CardDescription>
          Everything you add — contacts, deals, invoices — lives inside it. You
          can rename it later.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <FormAlert message={formError} />

          <Field error={fieldErrors.name} required>
            <FieldLabel htmlFor="workspace-name">Organisation name</FieldLabel>
            <Input
              id="workspace-name"
              type="text"
              autoComplete="organization"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={fieldErrors.name ? "true" : undefined}
              placeholder="Northwind Trading"
            />
            <FieldHint>
              This becomes the name your team sees in the switcher.
            </FieldHint>
            <FieldError>{fieldErrors.name}</FieldError>
          </Field>
        </CardContent>

        <CardFooter className="flex-col gap-3">
          <Button type="submit" loading={pending} className="w-full">
            Create workspace
          </Button>
          <p className="text-center text-sm text-ink-500 dark:text-ink-400">
            <Link
              href="/sign-in"
              className="text-ink-900 underline underline-offset-4 dark:text-ink-50"
            >
              Sign in with a different account
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
