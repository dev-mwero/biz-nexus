import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, Skeleton } from "@/components/ui";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Choose a new password for your BizNexus account.",
};

/**
 * Reset password.
 *
 * A server component for `metadata`, wrapping a client form that reads the token
 * from `?token=`. The `Suspense` boundary is required for the same reason it is
 * on sign-in: `useSearchParams` opts the subtree out of prerendering, and
 * without a boundary above it the whole route is client-rendered and the
 * production build fails.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordFallback() {
  return (
    <Card variant="outlined" aria-busy="true">
      <CardHeader>
        <Skeleton className="h-5 w-44" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </CardContent>
    </Card>
  );
}
