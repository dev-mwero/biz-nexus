/**
 * Placeholder for the sign-in page.
 *
 * Task 1.16 is the proxy; the real form is a later UI task. This page exists so
 * the redirect target resolves and the redirect itself is testable — a proxy
 * that redirects to a 404 is not a working proxy.
 *
 * Route groups use parentheses and do not appear in the URL, so this file is
 * served at /sign-in.
 */
export default function SignInPage() {
  return (
    <main>
      <h1>Sign in</h1>
      <p>Authentication form lands in a later task.</p>
    </main>
  );
}
