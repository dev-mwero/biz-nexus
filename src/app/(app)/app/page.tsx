import { redirect } from "next/navigation";

/**
 * Legacy alias for the dashboard.
 *
 * `/app` predates the real dashboard at `/dashboard` and is still the
 * `DEFAULT_AUTHENTICATED_PATH` the proxy sends a signed-in visitor to, so it has
 * to resolve to something useful. Redirecting keeps a single dashboard
 * implementation instead of a second placeholder that drifts from it.
 */
export default function LegacyAppPage() {
  redirect("/dashboard");
}
