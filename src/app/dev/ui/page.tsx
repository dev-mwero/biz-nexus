import type { Metadata } from "next";
import { ThemeToggle } from "@/components/providers/theme-toggle";
import { UiPlayground } from "./playground";

export const metadata: Metadata = {
  title: "UI playground",
  description: "Development-only surface for reviewing the design system.",
  robots: { index: false, follow: false },
};

export default function UiPlaygroundPage() {
  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-10 flex items-start justify-between gap-4 border-b border-line pb-6 dark:border-line">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-ink-900 dark:text-ink-50">
              UI playground
            </h1>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              Development only. Not linked from the app and excluded from
              search.
            </p>
          </div>
          <ThemeToggle />
        </header>
        <UiPlayground />
      </div>
    </main>
  );
}
