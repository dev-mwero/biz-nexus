"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  FieldLabel,
  Input,
} from "@/components/ui";
import { safeNextPath } from "@/shared/auth/session-cookie";

/**
 * The sign-in form.
 *
 * Posts to the API rather than a server action, because the endpoints this page
 * needs already exist and are the contract: `/login` sets the session cookie and
 * `/me` is the only call that knows whether the account belongs to an
 * organisation. Routing on `/me`'s answer rather than on anything the form was
 * handed is what keeps a returning user on the page they asked for and a new
 * account on the form that gives it an organisation.
 *
 * The destination order is the whole of the "where next?" decision:
 *
 *   1. `?next=`, if `safeNextPath` accepts it. The proxy puts the page the
 *      visitor was refused on into the query string, so honouring it is the
 *      difference between signing in and continuing what they came to do. It
 *      goes through `safeNextPath` because the value is attacker-suppliable, and
 *      an unvalidated one turns this page into an open redirect placed after a
 *      successful login — the most convincing possible phishing moment.
 *   2. `/dashboard`, when the account has an organisation: active, or merely
 *      belonging to one.
 *   3. `/onboarding`, otherwise. A new account has no organisation, and the
 *      dashboard would refuse every query it makes.
 *
 * `router.refresh()` follows the navigation rather than preceding it. The cookie
 * arrives on the login response, and a refresh issued before the navigation
 * would re-render the route the visitor is leaving with a session the new route
 * has not asked for yet.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The inputs this form renders, which is what a `details` path can name. */
const FIELDS = ["email", "password"] as const;

interface MeResponse {
  activeOrganizationId: string | null;
  organizations: unknown[];
}

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

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

    // The same two rules the server enforces, checked here so an empty or
    // obviously malformed submit is not a round trip that answers the same
    // thing. `noValidate` on the form is what keeps the browser's own bubble
    // from duplicating the message the field is already showing.
    const nextErrors: Record<string, string> = {};
    const trimmedEmail = email.trim();
    if (!trimmedEmail) nextErrors.email = "Enter your email address.";
    else if (!EMAIL_PATTERN.test(trimmedEmail))
      nextErrors.email = "Enter a valid email address.";
    if (!password) nextErrors.password = "Enter your password.";

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });

      if (!response.ok) {
        // Only a 422 has field `details` — the schema objecting to the body's
        // shape, before any account is looked up, so showing them leaks nothing.
        // Every other refusal is one message: unknown address, wrong password
        // and locked out must stay indistinguishable, because the endpoint is
        // deliberately not an oracle about which of them it was.
        const failure = toFormError(await readErrorPayload(response), FIELDS);

        if (response.status === 422 && Object.keys(failure.fields).length > 0) {
          setFieldErrors(failure.fields);
          return;
        }

        setFormError(failure.form ?? "Sign in failed. Try again.");
        return;
      }

      const me = await fetch("/api/v1/auth/me");
      if (!me.ok) {
        // Signed in, but the cookie just written is not one `/me` accepts. The
        // dashboard is the least wrong place to land: the shell renders its own
        // error rather than this form claiming a failure it cannot explain.
        router.push("/dashboard");
        router.refresh();
        return;
      }

      const session = (await me.json()) as { data: MeResponse };
      const next = safeNextPath(searchParams.get("next"));
      const hasOrganization =
        Boolean(session.data.activeOrganizationId) ||
        session.data.organizations.length > 0;

      router.push(next ?? (hasOrganization ? "/dashboard" : "/onboarding"));
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Check your connection.");
    } finally {
      // Left enabled on the success paths above: the component is being
      // navigated away from, and re-enabling a button the visitor may still be
      // looking at would only invite a second submit at a page that is closing.
      setPending(false);
    }
  };

  return (
    <Card variant="outlined">
      <CardHeader>
        <h1 className="font-display text-md font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
          Sign in
        </h1>
        <CardDescription>Welcome back. Enter your details.</CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          <FormAlert message={formError} />

          <Field error={fieldErrors.email} required>
            <FieldLabel htmlFor="signin-email">Email</FieldLabel>
            <Input
              id="signin-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={fieldErrors.email ? "true" : undefined}
              placeholder="you@company.com"
            />
            <FieldError>{fieldErrors.email}</FieldError>
          </Field>

          <Field error={fieldErrors.password} required>
            <FieldLabel htmlFor="signin-password">Password</FieldLabel>
            <Input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={fieldErrors.password ? "true" : undefined}
            />
            <FieldError>{fieldErrors.password}</FieldError>
          </Field>

          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-xs text-ink-500 underline-offset-4 hover:text-ink-900 hover:underline dark:text-ink-400 dark:hover:text-ink-50"
            >
              Forgot password?
            </Link>
          </div>
        </CardContent>

        <CardFooter className="flex-col gap-3">
          <Button type="submit" loading={pending} className="w-full">
            Sign in
          </Button>
          <p className="text-center text-sm text-ink-500 dark:text-ink-400">
            Don&apos;t have an account?{" "}
            <Link
              href="/sign-up"
              className="text-ink-900 underline underline-offset-4 dark:text-ink-50"
            >
              Sign up
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
