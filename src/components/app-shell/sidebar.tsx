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
import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Whether a media query currently matches, kept in sync with the viewport.
 *
 * Starts `false` so the server and the first client render agree; the drawer is
 * therefore treated as a desktop sidebar until the first effect runs. Getting
 * this wrong the other way would hide the navigation during hydration.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function Sidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const sidebarRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * The panel is a `<div role="dialog">` on mobile and an `<aside>` on desktop,
   * so the ref is a callback typed against the shared base element rather than
   * a `RefObject` that only fits one of them.
   */
  const captureSidebar = useCallback((node: HTMLElement | null) => {
    sidebarRef.current = node;
  }, []);

  /**
   * Below `lg` the drawer is translated off-canvas rather than unmounted, and a
   * transform does not remove anything from the tab order — so a keyboard user
   * would tab through nine invisible links before reaching the page. Only the
   * drawer's `closed` state needs this; on desktop it is always visible.
   */
  const isCompact = useMediaQuery("(max-width: 1023px)");
  const isHidden = isCompact && !isOpen;
  /**
   * The drawer is a modal only while it is overlaying the page. On desktop it
   * is a permanent sidebar, so trapping focus there would trap the whole app.
   */
  const isModal = isCompact && isOpen;

  const canReadAudit = session?.permissions.includes("auditLogs.read") ?? false;
  const canReadProducts =
    session?.permissions.includes("products.read") ?? false;
  const visible = navigation.filter(
    (item) => item.href !== "/products" || canReadProducts,
  );
  const items = canReadAudit ? [...visible, auditNavigation] : visible;

  useEffect(() => {
    if (isModal) {
      // Where focus was before the drawer opened. Closing a modal has to hand
      // focus back, or a keyboard user is dropped at the top of the document.
      const opener = document.activeElement as HTMLElement | null;
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      // Focus close button when opened
      const focusTimer = setTimeout(() => closeButtonRef.current?.focus(), 0);
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
        clearTimeout(focusTimer);
        document.body.style.overflow = prevOverflow;
        document.removeEventListener("keydown", handleKeyDown);
        if (opener?.isConnected) opener.focus();
      };
    }
    document.body.style.overflow = "";
  }, [isModal, onClose]);

  /**
   * The drawer and the desktop sidebar are the same navigation in two very
   * different containers: `<aside>` is a complementary landmark, and a landmark
   * cannot also be a modal dialog. Rendering the right element for the state
   * keeps both roles honest instead of overloading one node.
   */
  const drawerClasses = cn(
    "fixed top-0 left-0 z-50 h-screen w-64 bg-surface border-r border-line transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:translate-x-0",
    isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
  );

  const drawerContent = (
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
              pathname === item.href || pathname.startsWith(item.href + "/");
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
  );

  return (
    <>
      {/* Mobile overlay */}
      {isModal && (
        <div
          className="fixed inset-0 z-40 bg-ink-900/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {isModal ? (
        <div
          ref={captureSidebar}
          id="main-navigation"
          role="dialog"
          aria-modal="true"
          aria-label="Main navigation"
          tabIndex={-1}
          className={drawerClasses}
        >
          {drawerContent}
        </div>
      ) : (
        <aside
          ref={captureSidebar}
          id="main-navigation"
          aria-label="Main navigation"
          // `inert` removes the off-canvas drawer from the tab order and the
          // accessibility tree; `-translate-x-full` only moves pixels.
          inert={isHidden || undefined}
          className={drawerClasses}
        >
          {drawerContent}
        </aside>
      )}
    </>
  );
}

/**
 * The mobile navigation trigger.
 *
 * Lives here rather than inline in the header so that the hidden/visible state
 * is reported by the same component that owns the drawer, and so that
 * `aria-expanded` cannot drift from the real state — the header used to hardcode
 * it to `false`, which told every screen reader the menu was always collapsed.
 */
export function SidebarTrigger({
  onClick,
  isOpen,
}: {
  onClick: () => void;
  isOpen: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="lg:hidden"
      onClick={onClick}
      aria-label="Open main navigation"
      aria-expanded={isOpen}
      aria-controls="main-navigation"
    >
      <Menu className="size-5" aria-hidden="true" />
    </Button>
  );
}
