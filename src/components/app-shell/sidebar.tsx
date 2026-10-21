"use client";

import {
  Building2,
  CheckSquare,
  Clock,
  Kanban,
  LayoutDashboard,
  Menu,
  Package,
  ScrollText,
  Settings,
  Target,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/shared/auth/session-client";
import { cn } from "@/shared/lib/cn";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Contacts", href: "/crm/contacts", icon: User },
  { name: "Companies", href: "/crm/companies", icon: Building2 },
  { name: "Leads", href: "/crm/leads", icon: Target },
  { name: "Deals", href: "/deals", icon: Kanban },
  { name: "Products", href: "/products", icon: Package },
  { name: "Tasks", href: "/tasks", icon: CheckSquare },
  { name: "Activities", href: "/activities", icon: Clock },
  { name: "Settings", href: "/settings", icon: Settings },
];

/**
 * The audit screen is listed only for a session that can read it.
 *
 * The page and the API both refuse a non-owner, so this is not the gate — but a
 * navigation entry that leads to "not available" is worse than no entry at all,
 * and the permission is already in the session payload.
 */
const auditNavigation = {
  name: "Audit log",
  href: "/audit-logs",
  icon: ScrollText,
};

export function Sidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const canReadAudit = session?.permissions.includes("auditLogs.read") ?? false;
  const canReadProducts =
    session?.permissions.includes("products.read") ?? false;
  const visible = navigation.filter(
    (item) => item.href !== "/products" || canReadProducts,
  );
  const items = canReadAudit ? [...visible, auditNavigation] : visible;

  useEffect(() => {
    if (isOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      // Focus close button when opened
      setTimeout(() => closeButtonRef.current?.focus(), 0);
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        if (e.key === "Tab" && sidebarRef.current) {
          const focusableElements = sidebarRef.current.querySelectorAll(
            'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])',
          );
          const firstElement = focusableElements[0] as HTMLElement;
          const lastElement = focusableElements[
            focusableElements.length - 1
          ] as HTMLElement;
          if (focusableElements.length === 0) return;
          if (e.shiftKey) {
            if (document.activeElement === firstElement) {
              e.preventDefault();
              lastElement?.focus();
            }
          } else {
            if (document.activeElement === lastElement) {
              e.preventDefault();
              firstElement?.focus();
            }
          }
        }
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.body.style.overflow = prevOverflow;
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
    document.body.style.overflow = "";
  }, [isOpen, onClose]);

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
        ref={sidebarRef}
        id="main-navigation"
        aria-label="Main navigation"
        role={isOpen ? "dialog" : undefined}
        aria-modal={isOpen ? true : undefined}
        tabIndex={isOpen ? -1 : undefined}
        className={cn(
          "fixed top-0 left-0 z-50 h-screen w-64 bg-surface border-r border-line transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex h-full flex-col">
          {/* Sidebar header */}
          <div className="flex h-16 items-center justify-between border-b border-line px-4 lg:px-5">
            <Link
              href="/dashboard"
              className="flex items-center gap-2"
              aria-label="BizNexus Home"
            >
              <div
                className="size-8 rounded-lg bg-brand flex items-center justify-center"
                aria-hidden="true"
              >
                <LayoutDashboard className="size-5 text-brand-fg" />
              </div>
              <span className="font-display font-semibold text-lg text-ink-900 dark:text-ink-50">
                BizNexus
              </span>
            </Link>
            <button
              ref={closeButtonRef}
              type="button"
              className={cn(
                "lg:hidden inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors",
                "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "h-9 w-9",
              )}
              onClick={onClose}
              aria-label="Close sidebar"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav
            className="flex-1 overflow-y-auto p-3 lg:p-4 space-y-1"
            aria-label="Main navigation"
          >
            <ul className="space-y-1">
              {items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                return (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      className={cn(
                        "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                        isActive
                          ? "bg-nav-active-bg text-nav-active-fg"
                          : "text-ink-700 hover:bg-surface-hover dark:text-ink-200 dark:hover:bg-surface-hover",
                      )}
                      aria-current={isActive ? "page" : undefined}
                      onClick={onClose}
                    >
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-info"
                        />
                      )}
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

export function SidebarTrigger({
  onClick,
  isOpen,
}: {
  onClick: () => void;
  isOpen?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="lg:hidden"
      onClick={onClick}
      aria-label="Open main navigation"
      aria-expanded={!!isOpen}
      aria-controls="main-navigation"
    >
      <Menu className="size-5" />
    </Button>
  );
}
