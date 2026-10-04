"use client";

import {
  Bell,
  Building2,
  ChevronDown,
  LogOut,
  Search,
  Settings,
  User,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/shared/auth/session-client";
import { cn } from "@/shared/lib/cn";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { data: session, refresh } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const handleSignOut = async () => {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    refresh();
    router.push("/sign-in");
  };

  const handleSwitchOrg = async (orgId: string) => {
    await fetch("/api/v1/organizations/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId }),
    });
    refresh();
    router.refresh();
  };

  const organizations = session?.organizations ?? [];
  const activeOrgId = session?.activeOrganizationId;

  return (
    <header className="sticky top-0 z-30 h-16 bg-surface/95 backdrop-blur-sm border-b border-line">
      <div className="flex h-full items-center justify-between px-4 lg:px-6">
        {/* Left: Menu trigger + Breadcrumbs */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onMenuClick}
            aria-label="Open main navigation"
            aria-expanded="false"
          >
            <Search className="size-5" />
          </Button>

          {/* Breadcrumbs */}
          <nav
            className="hidden sm:flex items-center gap-1.5 text-sm"
            aria-label="Breadcrumb"
          >
            <ol className="flex items-center gap-1.5">
              <li>
                <a
                  href="/dashboard"
                  className={cn(
                    "text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-50",
                    pathname === "/dashboard" &&
                      "text-ink-900 dark:text-ink-50 font-medium",
                  )}
                  aria-current={pathname === "/dashboard" ? "page" : undefined}
                >
                  Dashboard
                </a>
              </li>
              {pathname !== "/dashboard" && (
                <>
                  <li aria-hidden="true">
                    <ChevronDown className="size-3 text-ink-400 dark:text-ink-500" />
                  </li>
                  <li>
                    <span className="text-ink-900 dark:text-ink-50 font-medium truncate max-w-[200px]">
                      {getPageTitle(pathname)}
                    </span>
                  </li>
                </>
              )}
            </ol>
          </nav>
        </div>

        {/* Right: Notifications + User menu + Org switcher */}
        <div className="flex items-center gap-2">
          {/* Organization Switcher */}
          {organizations.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 px-3 h-9"
                    aria-label={`Current organization: ${getActiveOrgName()}`}
                    aria-haspopup="menu"
                    aria-expanded={false}
                  >
                    <Building2 className="size-4" aria-hidden="true" />
                    <span className="truncate max-w-[140px] font-medium">
                      {getActiveOrgName()}
                    </span>
                    <ChevronDown className="size-4" aria-hidden="true" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Switch Organization</DropdownMenuLabel>
                {organizations.map((org) => (
                  <DropdownMenuItem
                    key={org.id}
                    onClick={() => handleSwitchOrg(org.id)}
                    className={cn(
                      activeOrgId === org.id &&
                        "bg-info-surface text-info dark:bg-info-surface/30",
                    )}
                    aria-current={activeOrgId === org.id ? "true" : undefined}
                  >
                    {org.name}
                    {activeOrgId === org.id && (
                      <span
                        className="ml-auto text-xs text-info"
                        aria-hidden="true"
                      >
                        Active
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Notifications Bell */}
          <NotificationBell />

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative h-9 w-9 rounded-full"
                  aria-label={`User menu for ${session?.user?.name ?? "user"}`}
                  aria-haspopup="menu"
                  aria-expanded={false}
                >
                  <div className="size-9 rounded-full bg-info-surface flex items-center justify-center overflow-hidden">
                    {session?.user?.avatarUrl ? (
                      <img
                        src={session.user.avatarUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="font-display font-medium text-info">
                        {session?.user?.name?.charAt(0).toUpperCase() ?? "?"}
                      </span>
                    )}
                  </div>
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="px-2">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-full bg-info-surface flex items-center justify-center">
                    {session?.user?.avatarUrl ? (
                      <img
                        src={session.user.avatarUrl}
                        alt=""
                        className="size-full object-cover rounded-full"
                      />
                    ) : (
                      <span className="font-display font-medium text-info">
                        {session?.user?.name?.charAt(0).toUpperCase() ?? "?"}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {session?.user?.name}
                    </p>
                    <p className="text-xs text-ink-500 dark:text-ink-400 truncate">
                      {session?.user?.email}
                    </p>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/settings")}>
                <Settings className="size-4 mr-2" aria-hidden="true" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} destructive>
                <LogOut className="size-4 mr-2" aria-hidden="true" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );

  function getActiveOrgName(): string {
    const org = organizations.find((o) => o.id === activeOrgId);
    return org?.name ?? "No organization";
  }

  function getPageTitle(path: string): string {
    const segments = path.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    return (
      lastSegment.charAt(0).toUpperCase() +
      lastSegment.slice(1).replace(/-/g, " ")
    );
  }
}
