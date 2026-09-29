/**
 * Authenticated shell. Route group `(app)`, so its children are served at the
 * root level — `/app`, `/deals` — rather than under `/app/app`.
 *
 * The proxy redirects a visitor without a session cookie before this layout
 * renders. That is a convenience, not the control: the DAL guard in the page's
 * server component or the route handler is what actually refuses the request,
 * because the proxy only ever saw that a cookie existed.
 */
export default function AppShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <main>{children}</main>;
}
