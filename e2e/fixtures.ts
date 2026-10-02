import { type APIRequestContext, test as base, expect } from "@playwright/test";

/**
 * Shared Playwright fixtures for the E2E suite.
 *
 * The specs are API-level: they drive `/api/v1` with `request`, not a browser.
 * Two properties of the real API have to be reproduced for a request to be
 * treated as legitimate, and neither is a default of Playwright's own `request`
 * fixture:
 *
 *   - `Origin`. Every mutating route runs `assertSameOrigin`, which fails closed
 *     on a missing `Origin` and on any value that is not `env.APP_URL`'s origin.
 *     Playwright's `request` fixture sends no `Origin` at all, so without this
 *     every POST/PUT/PATCH/DELETE in the suite is a 403 before it reaches a
 *     handler.
 *   - `baseURL`. The built-in fixture is created with no options, so it inherits
 *     nothing from `use`; relative paths would have no host to resolve against.
 *
 * Overriding the fixture once is both the smaller change and the honest one:
 * `use.extraHTTPHeaders` looks like it should apply, and does not, because the
 * request context is built independently of the browser context options. A
 * helper that every call site remembered to spread would work until the first
 * call site that did not.
 *
 * `BASE_URL` must stay equal to the server's `APP_URL` origin. The E2E server
 * boots in production mode over plain HTTP, and `localhost` is the one host
 * `src/env.ts` permits there, so the two are intentionally the same value.
 *
 * The port defaults to 3100, matching playwright.config.ts, so the suite talks
 * to its own production server rather than a developer's `next dev` on 3000.
 */
const DEFAULT_E2E_PORT = 3100;

export const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  `http://localhost:${process.env.PLAYWRIGHT_PORT ?? DEFAULT_E2E_PORT}`;

export const test = base.extend<{ request: APIRequestContext }>({
  request: async ({ playwright }, use) => {
    const context = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Origin: BASE_URL },
    });
    await use(context);
    await context.dispose();
  },
});

export { expect };
