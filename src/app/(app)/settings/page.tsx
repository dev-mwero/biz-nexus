import { Settings } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Settings" };

/**
 * Placeholder. The settings screens themselves are a later task; this exists so
 * the nav, command palette and user menu have somewhere real to land instead of
 * a 404.
 */
export default function SettingsPage() {
  return (
    <EmptyState
      icon={Settings}
      title="Settings"
      description="Workspace, member and billing settings are coming soon."
      action={{ label: "Back to dashboard", href: "/dashboard" }}
    />
  );
}
