"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSession } from "@/shared/auth/session-client";

/**
 * Send a signed-in user with no active organisation to `/onboarding`.
 *
 * "Signed in, no organisation" is a real state, not an error: the API returns
 * `activeOrganizationId: null` with an empty permission list rather than
 * refusing. Every screen behind the shell needs an organisation to query, so
 * without this the user lands on a page whose every request comes back 403,
 * with no indication that the fix is to name their workspace.
 *
 * Two guards, because each one is a way this becomes a redirect loop:
 *
 *   - `loading`. The provider starts with `data === null` and `loading === true`,
 *     and treating that null as "no session" would bounce every user to sign-in
 *     on every page load, including ones with a perfectly good cookie.
 *   - `redirected`. A ref, so the effect fires once. The session does not change
 *     identity when `router.replace` runs, and without this the effect would
 *     re-fire on the re-render and push a second history entry.
 *
 * No pathname check is needed: this renders inside the `(app)` shell, and
 * `/onboarding` lives outside it, so the two never run on the same page.
 */
export function OnboardingRedirect() {
  const router = useRouter();
  const { data, loading } = useSession();
  const redirected = useRef(false);

  useEffect(() => {
    if (loading || redirected.current) return;
    if (!data?.user) return;
    if (data.activeOrganizationId) return;

    redirected.current = true;
    router.replace("/onboarding");
  }, [loading, data, router]);

  return null;
}
