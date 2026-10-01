"use client";

import { useState } from "react";
import { SessionProvider } from "@/shared/auth/session-client";
import { cn } from "@/shared/lib/cn";
import { CommandPalette } from "./command-palette";
import { Header } from "./header";
import { OnboardingRedirect } from "./onboarding-redirect";
import { Sidebar, SidebarTrigger } from "./sidebar";

/**
 * The authenticated shell.
 *
 * `OnboardingRedirect` sits inside `SessionProvider` because it reads the
 * session, and it is a sibling of the chrome rather than a wrapper: it renders
 * nothing, so the shell lays out exactly as it did before the check existed.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <SessionProvider>
      <OnboardingRedirect />
      <div className="min-h-screen bg-canvas">
        {/* Skip to main content link - first focusable element */}
        <a
          href="#main-content"
          className={cn(
            "sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4",
            "bg-info text-white px-4 py-2 rounded-md font-medium",
            "focus:outline-none focus:ring-2 focus:ring-info focus:ring-offset-2",
          )}
        >
          Skip to main content
        </a>

        {/* Sidebar - navigation landmark */}
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Command palette - dialog */}
        <CommandPalette />

        {/* Main app area */}
        <div className="lg:pl-64">
          {/* Header - banner landmark */}
          <Header onMenuClick={() => setSidebarOpen(true)} />

          {/* Main content - main landmark */}
          <main id="main-content" className="p-4 sm:p-6 lg:p-8" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
