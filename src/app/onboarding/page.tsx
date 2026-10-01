import type { Metadata } from "next";
import { SessionProvider } from "@/shared/auth/session-client";
import { OnboardingForm } from "./onboarding-form";

/**
 * First run: name the organisation.
 *
 * A server component so the page can export `metadata`; the interactive part is
 * `OnboardingForm`. The `(auth)` layout does not wrap this route — onboarding is
 * reached while signed in, and putting it inside the sign-in surface would show a
 * "BizNexus" wordmark above a page that is not a sign-in — so it brings its own
 * centered surface, identical to the one in `src/app/(auth)/layout.tsx`.
 *
 * `SessionProvider` is here rather than in the form because this route is outside
 * the `(app)` shell, which is where the provider otherwise lives. It is what lets
 * `refresh()` run after creation, so a shell that mounts from cache sees the new
 * organisation rather than the empty one it just replaced.
 */
export const metadata: Metadata = {
  title: "Create your workspace",
  description:
    "Name your workspace to finish setting up your BizNexus account.",
  robots: { index: false, follow: false },
};

export default function OnboardingPage() {
  return (
    <SessionProvider>
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
        <div className="w-full max-w-sm">
          <OnboardingForm />
        </div>
      </main>
    </SessionProvider>
  );
}
