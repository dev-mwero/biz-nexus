"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
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
} from "@/components/ui";

/**
 * Create an account.
 *
 * Registration signs the user in on the way through — the endpoint returns a
 * session cookie with a 201 — so there is no second call to `/login` here and no
 * window where an account exists but nobody is signed in to it.
 *
 * Onboarding comes next rather than the dashboard, and not as a stylistic
 * choice: a brand-new account has no organisation, so every query the dashboard
 * makes is refused. `/onboarding` is the page that fixes that, and the shell's
 * redirect would send the user there a moment later regardless.
 *
 * `EMAIL_ALREADY_REGISTERED` is answered on the email field rather than as a form
 * error. The endpoint is the one place in the API that acknowledges a registered
 * address — deliberately, because a form has to be able to say "this is taken" —
 * and putting that message next to the box that caused it is the only placement
 * that tells the visitor which of their three inputs to change.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** docs/SECURITY.md §4. The floor is length, not composition. */
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 200;

const NAME_MAX = 120;

const FIELDS = ["name", "email", "password"] as const;

export function SignUpForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    setFieldErrors({});
    setFormError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    const nextErrors: Record<string, string> = {};
    if (!trimmedName) nextErrors.name = "Enter your name.";
    else if (trimmedName.length > NAME_MAX)
      nextErrors.name = `Use at most ${NAME_MAX} characters.`;
    if (!trimmedEmail) nextErrors.email = "Enter your email address.";
    else if (!EMAIL_PATTERN.test(trimmedEmail))
      nextErrors.email = "Enter a valid email address.";
    if (!password) nextErrors.password = "Choose a password.";
    else if (password.length < PASSWORD_MIN)
      nextErrors.password = `Use at least ${PASSWORD_MIN} characters.`;
    else if (password.length > PASSWORD_MAX)
      nextErrors.password = `Use at most ${PASSWORD_MAX} characters.`;

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          password,
        }),
      });

      if (!response.ok) {
        const payload = await readErrorPayload(response);

        // The one refusal the API names, because a form has to be able to say
        // "this is taken". It goes on the email field, which is the only
        // placement that tells the visitor which of their three inputs to
        // change.
        if (payload.code === "EMAIL_ALREADY_REGISTERED") {
          setFieldErrors({ email: payload.message });
          return;
        }

        // Everything else splits the same way as the other forms: a `details`
        // path naming one of these inputs becomes a field error, and whatever
        // is left says itself once, above the form.
        const failure = toFormError(payload, FIELDS);
        setFieldErrors(failure.fields);
        setFormError(failure.form);
        return;
      }

      router.push("/onboarding");
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Check your connection.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card variant="outlined">
      <CardHeader>
        <h1 className="font-display text-md font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
          Create your account
        </h1>
        <CardDescription>
          One organisation, your team, everything in one place.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <FormAlert message={formError} />

          <Field error={fieldErrors.name} required>
            <FieldLabel htmlFor="signup-name">Full name</FieldLabel>
            <Input
              id="signup-name"
              type="text"
              autoComplete="name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={fieldErrors.name ? "true" : undefined}
              placeholder="Ada Lovelace"
            />
            <FieldError>{fieldErrors.name}</FieldError>
          </Field>

          <Field error={fieldErrors.email} required>
            <FieldLabel htmlFor="signup-email">Work email</FieldLabel>
            <Input
              id="signup-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={fieldErrors.email ? "true" : undefined}
              placeholder="you@company.com"
            />
            <FieldError>{fieldErrors.email}</FieldError>
          </Field>

          <Field error={fieldErrors.password} required>
            <FieldLabel htmlFor="signup-password">Password</FieldLabel>
            <Input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={fieldErrors.password ? "true" : undefined}
            />
            <FieldHint>At least {PASSWORD_MIN} characters.</FieldHint>
            <FieldError>{fieldErrors.password}</FieldError>
          </Field>
        </CardContent>

        <CardFooter className="flex-col gap-3">
          <Button type="submit" loading={pending} className="w-full">
            Create account
          </Button>
          <p className="text-center text-sm text-ink-500 dark:text-ink-400">
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="text-ink-900 underline underline-offset-4 dark:text-ink-50"
            >
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
