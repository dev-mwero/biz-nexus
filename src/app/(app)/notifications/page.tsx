import { Bell } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Notifications" };

/**
 * Placeholder for the notification inbox. The notifications API and the bell
 * already exist; this is the destination for it to open into.
 */
export default function NotificationsPage() {
  return (
    <EmptyState
      icon={Bell}
      title="Notifications"
      description="Your notification inbox is coming soon."
      action={{ label: "Back to dashboard", href: "/dashboard" }}
    />
  );
}
