"use client";

import { Settings } from "lucide-react";
import { InvitationsPanel } from "@/components/settings/invitations-panel";
import { MembersPanel } from "@/components/settings/members-panel";
import { OrganizationPanel } from "@/components/settings/organization-panel";
import {
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { useSession } from "@/shared/auth/session-client";

/**
 * Workspace settings.
 *
 * Three panels, each drawn from an endpoint that exists: the organisation's own
 * settings (WS2d), the member directory (WS2d), and the team invitations
 * (already present). The tab strip is the whole layout — there is no sub-routing,
 * because none of the panels is deep enough to need a URL of its own and a
 * `/settings/members` that a refresh has to resolve to the same tab is a router
 * concern this does not have yet.
 *
 * Permissions decide what is rendered, and the deciding is done here against
 * `useSession().permissions` rather than left to the panel. Each panel is told
 * what it may do, so a refusal looks like an absent control instead of a request
 * that comes back 403.
 */
export default function SettingsPage() {
  const { data: session, loading } = useSession();

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const permissions = session?.permissions ?? [];
  const canReadInvitations = permissions.includes("invitations.read");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div
          className="grid size-10 place-items-center rounded-lg border border-line bg-surface-sunken text-ink-500"
          aria-hidden="true"
        >
          <Settings className="size-5" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
            Settings
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Your workspace and the people in it.
          </p>
        </div>
      </div>

      <Tabs defaultValue="organisation">
        <TabsList>
          <TabsTrigger value="organisation">Organisation</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          {canReadInvitations && (
            <TabsTrigger value="invitations">Invitations</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="organisation">
          <OrganizationPanel
            canUpdate={permissions.includes("organization.update")}
          />
        </TabsContent>

        <TabsContent value="members">
          <MembersPanel
            currentUserId={session?.user?.id ?? null}
            canUpdate={permissions.includes("users.update")}
            canRemove={permissions.includes("users.remove")}
          />
        </TabsContent>

        {canReadInvitations && (
          <TabsContent value="invitations">
            <InvitationsPanel
              canInvite={permissions.includes("invitations.create")}
              canRevoke={permissions.includes("invitations.revoke")}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
