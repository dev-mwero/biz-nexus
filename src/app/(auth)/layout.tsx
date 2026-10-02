/**
 * The unauthenticated surface.
 *
 * One centred column on `bg-canvas`, shared by every page in the group, so that
 * sign-in, sign-up and password recovery are the same shape at every width and
 * a visitor who follows a link from a deep page lands somewhere recognisable.
 *
 * The wordmark is a `p`, not a heading. Every page in this group carries its own
 * `h1` describing the task, and a second `h1` here would make the heading list
 * lead with the brand rather than the thing the visitor came to do.
 *
 * Server component. Nothing here needs the browser, so this layout ships no
 * JavaScript at all and every page under it starts from that.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-center font-display text-xl font-semibold tracking-[-0.02em] text-ink-900 dark:text-ink-50">
          BizNexus
        </p>
        {children}
      </div>
    </main>
  );
}
