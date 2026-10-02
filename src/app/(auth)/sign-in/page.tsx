import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, Skeleton } from "@/components/ui";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your BizNexus account.",
};

/**
 * Sign in.
 *
 * A server component, because `metadata` cannot be exported from a `"use
 * client"` module and every page in this group is titled.
 *
 * The `Suspense` boundary is not decoration. `SignInForm` reads the query string
 * through `useSearchParams`, and with no boundary above it the closest fallback
 * is the entire route — which turns a page that could be prerendered into one
 * that cannot, and fails the production build outright. The fallback holds the
 * card's real geometry, so the form replaces a shape rather than pushing the
 * page around when it arrives.
 */
export default function SignInPage() {
  return (
    <Suspense fallback={<SignInFallback />}>
      <SignInForm />
    </Suspense>
  );
}

function SignInFallback() {
  return (
    <Card variant="outlined" aria-busy="true">
      <CardHeader>
        <Skeleton className="h-5 w-20" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </CardContent>
    </Card>
  );
}
