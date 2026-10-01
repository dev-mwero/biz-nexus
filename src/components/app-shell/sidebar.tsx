"use client";

import {
  Building2,
  CheckSquare,
  ChevronRight,
  Clock,
  Kanban,
  LayoutDashboard,
  Menu,
  Settings,
  Target,
  User,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/cn";

const navigation = [
  { name: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard },
  { name: "Contacts", href: "/app/contacts", icon: User },
  { name: "Companies", href: "/app/companies", icon: Building2 },
  { name: "Leads", href: "/app/leads", icon: Target },
  { name: "Deals", href: "/app/deals", icon: Kanban },
  { name: "Tasks", href: "/app/tasks", icon: CheckSquare },
  { name: "Activities", href: "/app/activities", icon: Clock },
  { name: "Settings", href: "/app/settings", icon: Settings },
];

export function Sidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink-900/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar - navigation landmark */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-screen bg-surface border-r border-line transition-transform duration-200 ease-out lg:relative lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
        aria-label="Main navigation"
        role="navigation"
      >
        <div className="flex h-full flex-col">
          {/* Sidebar header */}
          <div className="flex h-16 items-center justify-between border-b border-line px-4 lg:px-5">
            <Link
              href="/app/dashboard"
              className="flex items-center gap-2"
              aria-label="BizNexus Home"
            >
              <div
                className="size-8 rounded-lg bg-info flex items-center justify-center"
                aria-hidden="true"
              >
                <LayoutDashboard className="size-5 text-white" />
              </div>
              <span className="font-display font-semibold text-lg text-ink-900 dark:text-ink-50">
                BizNexus
              </span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={onClose}
              aria-label="Close sidebar"
            >
              <X className="size-5" />
            </Button>
          </div>

          {/* Navigation */}
          <nav
            className="flex-1 overflow-y-auto p-3 lg:p-4 space-y-1"
            aria-label="Main navigation"
          >
            <ul className="space-y-1" role="list">
              {navigation.map((item) => {
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                return (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                        isActive
                          ? "bg-info-surface text-info dark:bg-info-surface/30"
                          : "text-ink-700 hover:bg-surface-hover dark:text-ink-200 dark:hover:bg-surface-hover",
                      )}
                      aria-current={isActive ? "page" : undefined}
                      onClick={onClose}
                    >
                      <item.icon
                        className="size-5 flex-shrink-0"
                        aria-hidden="true"
                      />
                      {item.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Footer */}
          <div className="border-t border-line p-3 lg:p-4">
            <p className="text-xs text-ink-500 dark:text-ink-400 text-center">
              BizNexus MVP
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

export function SidebarTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="lg:hidden"
      onClick={onClick}
      aria-label="Open main navigation"
      aria-expanded="false"
      aria-controls="main-navigation"
    >
      <Menu className="size-5" />
    </Button>
  );
}
