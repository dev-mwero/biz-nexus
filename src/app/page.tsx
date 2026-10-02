import {
  ArrowRight,
  BarChart3,
  CheckSquare,
  Kanban,
  LayoutDashboard,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "BizNexus — run the whole business on one system",
  description:
    "CRM, sales pipeline, tasks and reporting for small and medium-sized organisations, on one tenant-safe foundation.",
  // The authenticated application opts out of indexing in the root layout; this
  // is the surface that should be found.
  robots: { index: true, follow: true },
};

const FEATURES = [
  {
    icon: Users,
    title: "Contacts and companies",
    body: "Every person, account and relationship in one place, with the history behind each one.",
  },
  {
    icon: Target,
    title: "Leads and deals",
    body: "Capture leads, qualify them, and move deals across a pipeline that reflects how you sell.",
  },
  {
    icon: Kanban,
    title: "Pipeline board",
    body: "See every deal by stage, spot what is stalling, and forecast from a single view.",
  },
  {
    icon: CheckSquare,
    title: "Tasks and activities",
    body: "Follow-ups, calls and meetings attach to the record they belong to — not a separate list.",
  },
  {
    icon: BarChart3,
    title: "Reporting",
    body: "Dashboards over your real data, so the numbers on screen match the ones in the database.",
  },
  {
    icon: ShieldCheck,
    title: "Tenant-safe by design",
    body: "Every record is scoped to its organisation at the data layer, not by a filter someone can forget.",
  },
] as const;

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="flex items-center gap-2"
            aria-label="BizNexus home"
          >
            <span
              className="flex size-8 items-center justify-center rounded-lg bg-info"
              aria-hidden="true"
            >
              <LayoutDashboard className="size-5 text-white" />
            </span>
            <span className="font-display text-lg font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
              BizNexus
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/sign-in"
              className="rounded-md px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-surface-hover dark:text-ink-200"
            >
              Sign in
            </Link>
            <ButtonLink href="/sign-up" size="sm">
              Get started
            </ButtonLink>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-line">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_50%_-10rem,var(--color-info-surface),transparent)]"
          />
          <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 py-24 text-center sm:px-6 lg:px-8 lg:py-32">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-600 dark:text-ink-300">
              <span
                className="size-1.5 rounded-full bg-info"
                aria-hidden="true"
              />
              The business operating system
            </span>
            <h1 className="max-w-3xl font-display text-4xl font-semibold tracking-[-0.02em] text-ink-900 sm:text-5xl lg:text-6xl dark:text-ink-50">
              Run the whole business on one system
            </h1>
            <p className="max-w-xl text-lg leading-8 text-ink-600 dark:text-ink-300">
              CRM, sales, tasks and reporting for small and medium-sized
              organisations — connected, tenant-safe, and honest about the
              numbers.
            </p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/sign-up" size="lg">
                Start free
                <ArrowRight className="size-4" aria-hidden="true" />
              </ButtonLink>
              <ButtonLink href="/sign-in" variant="secondary" size="lg">
                Sign in
              </ButtonLink>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.01em] text-ink-900 sm:text-3xl dark:text-ink-50">
              Everything a growing team needs
            </h2>
            <p className="mt-3 text-base text-ink-600 dark:text-ink-300">
              One set of records, shared by every part of the business, so
              nobody works from a stale copy.
            </p>
          </div>

          <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-6 shadow-sm"
              >
                <span
                  className="flex size-10 items-center justify-center rounded-lg bg-info-surface text-info"
                  aria-hidden="true"
                >
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <h3 className="font-display text-base font-semibold text-ink-900 dark:text-ink-50">
                  {title}
                </h3>
                <p className="text-sm leading-6 text-ink-600 dark:text-ink-300">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-line bg-surface">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-5 px-4 py-20 text-center sm:px-6 lg:px-8">
            <h2 className="max-w-2xl font-display text-2xl font-semibold tracking-[-0.01em] text-ink-900 sm:text-3xl dark:text-ink-50">
              Set up your workspace in a minute
            </h2>
            <p className="max-w-lg text-base text-ink-600 dark:text-ink-300">
              Create an account, name your organisation, and start adding
              contacts and deals. No card required.
            </p>
            <ButtonLink href="/sign-up" size="lg">
              Create your workspace
              <ArrowRight className="size-4" aria-hidden="true" />
            </ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-ink-500 sm:flex-row sm:px-6 lg:px-8 dark:text-ink-400">
          <p>© {new Date().getFullYear()} BizNexus</p>
          <nav className="flex items-center gap-5">
            <Link
              href="/sign-in"
              className="hover:text-ink-900 dark:hover:text-ink-50"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="hover:text-ink-900 dark:hover:text-ink-50"
            >
              Get started
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
