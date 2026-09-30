import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";
import {
  type CookieOptions,
  clearSessionCookie,
  readCookie,
  sessionCookie,
  shouldUseSecureCookies,
} from "@/shared/http/cookie";

/**
 * Cookie attributes.
 *
 * Each assertion below is a security property rather than a formatting
 * preference, and the whole point is that a regression here is invisible from
 * the outside: a cookie that stops being HttpOnly still works, it just becomes
 * stealable.
 */

function requestWith(cookie: string | null): Request {
  return new Request("https://app.test/api/v1/auth/login", {
    headers: cookie === null ? {} : { cookie },
  });
}

/** The attributes as a set, so order never makes a test fail spuriously. */
function attributes(setCookie: string): Map<string, string> {
  const [pair, ...rest] = setCookie.split("; ");
  const map = new Map<string, string>([
    ["value", decodeURIComponent(pair.slice(pair.indexOf("=") + 1))],
  ]);
  for (const attribute of rest) {
    const index = attribute.indexOf("=");
    if (index === -1) map.set(attribute, "true");
    else map.set(attribute.slice(0, index), attribute.slice(index + 1));
  }
  return map;
}

describe("sessionCookie", () => {
  it("sets the session cookie with the token as its value", () => {
    const cookie = sessionCookie("abc123", 3600);

    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(attributes(cookie).get("value")).toBe("abc123");
  });

  it("is HttpOnly, because the value is a bearer credential", () => {
    // Readable from JavaScript means any XSS on the site can steal it, and the
    // stolen value works from anywhere.
    expect(attributes(sessionCookie("t", 60)).has("HttpOnly")).toBe(true);
  });

  it("is SameSite=Lax, so links from mail still work", () => {
    // Strict would be stronger and would break every emailed invitation and
    // password-reset link this system depends on. Lax still withholds the
    // cookie from cross-site POSTs, which is what the state-changing endpoints
    // need.
    expect(attributes(sessionCookie("t", 60)).get("SameSite")).toBe("Lax");
  });

  it("is Secure outside development", () => {
    // The policy is unit-tested below. What matters here is that
    // `sessionCookie` actually consults it rather than hard-coding a value -
    // this process runs as NODE_ENV=test, so the default must be insecure and
    // the emitted cookie must follow whatever the environment says.
    expect(shouldUseSecureCookies("production")).toBe(true);
    expect(attributes(sessionCookie("t", 60)).has("Secure")).toBe(
      shouldUseSecureCookies(),
    );
  });

  it("cannot have Secure switched off by a call site", () => {
    // There is no `secure` option, so `npm run typecheck` rejects one. This
    // covers the case the type does not: something that bypasses it entirely.
    // Under `options.secure ?? shouldUseSecureCookies()` this call would emit
    // `Secure` in a test process, and a route that grew the option would have
    // been able to strip it from a production cookie.
    const smuggled = { secure: true } as CookieOptions;
    expect(attributes(sessionCookie("t", 60, smuggled)).has("Secure")).toBe(
      shouldUseSecureCookies(),
    );
  });

  it("defaults Secure to whatever the environment policy says", () => {
    // Hard-coding Secure here would make the sign-in form silently do nothing
    // in development, which is a far more common bug than a missing Secure.
    expect(attributes(sessionCookie("t", 60)).has("Secure")).toBe(
      shouldUseSecureCookies(),
    );
  });

  it("is not Secure in development or test, where there is no certificate", () => {
    // A Secure cookie over plain HTTP is silently dropped by every browser, so
    // this presents as "the sign-in form does nothing".
    expect(shouldUseSecureCookies("development")).toBe(false);
    expect(shouldUseSecureCookies("test")).toBe(false);
    expect(attributes(sessionCookie("t", 60)).has("Secure")).toBe(false);
  });

  it("defaults to Secure when NODE_ENV is unset", () => {
    // An unset NODE_ENV in a deployed process is a misconfiguration, and failing
    // towards sending the credential in the clear is the wrong direction.
    expect(shouldUseSecureCookies("")).toBe(true);
  });

  it("is Secure for every value other than the two local environments", () => {
    // The allow-list form, asserted against the value that would break it. A
    // predicate written as `=== "production"` passes all of the cases above and
    // then fails towards NOT sending Secure the day a `staging` or `preview`
    // value appears — the one direction that must not happen.
    for (const value of [
      "production",
      "staging",
      "preview",
      "test ",
      "Test",
      "prod",
      "anything-else",
    ]) {
      expect(shouldUseSecureCookies(value), value).toBe(true);
    }
  });

  it("carries the session lifetime as Max-Age", () => {
    // Relative, so it does not depend on the client clock, and a device with a
    // wrong clock cannot end up holding a cookie that outlives revocation.
    expect(attributes(sessionCookie("t", 3600)).get("Max-Age")).toBe("3600");
  });

  it("scopes to the whole site, because the proxy reads it on every route", () => {
    expect(attributes(sessionCookie("t", 60)).get("Path")).toBe("/");
  });

  it("percent-encodes a value that would otherwise break the header", () => {
    // A raw semicolon or comma in a cookie value truncates the header, and a
    // token that arrives truncated looks like a wrong token.
    const cookie = sessionCookie("a;b,c d", 60);
    expect(cookie).not.toMatch(/=[^;]*,/);
    expect(attributes(cookie).get("value")).toBe("a;b,c d");
  });

  it("never emits a negative Max-Age", () => {
    expect(attributes(sessionCookie("t", -5)).get("Max-Age")).toBe("0");
  });
});

describe("clearSessionCookie", () => {
  it("expires the cookie immediately", () => {
    expect(attributes(clearSessionCookie()).get("Max-Age")).toBe("0");
  });

  it("matches the path the cookie was set with", () => {
    // A cookie is identified by name, domain and path. A mismatch here makes
    // the delete a no-op that looks like a sign-out bug.
    expect(attributes(clearSessionCookie()).get("Path")).toBe(
      attributes(sessionCookie("t", 60)).get("Path"),
    );
  });

  it("keeps HttpOnly and SameSite, so the deletion is the cookie being replaced", () => {
    const cleared = attributes(clearSessionCookie());
    const set = attributes(sessionCookie("t", 60));

    expect(cleared.has("HttpOnly")).toBe(set.has("HttpOnly"));
    expect(cleared.get("SameSite")).toBe(set.get("SameSite"));
    expect(cleared.has("Secure")).toBe(set.has("Secure"));
  });
});

describe("readCookie", () => {
  it("reads the session cookie", () => {
    expect(
      readCookie(requestWith(`${SESSION_COOKIE}=abc123`), SESSION_COOKIE),
    ).toBe("abc123");
  });

  it("returns null when there is no cookie header at all", () => {
    // A request without a session is the normal unauthenticated case, not an
    // error.
    expect(readCookie(requestWith(null), SESSION_COOKIE)).toBeNull();
  });

  it("returns null when the header has cookies but not this one", () => {
    expect(readCookie(requestWith("a=1; b=2"), SESSION_COOKIE)).toBeNull();
  });

  it("finds the cookie among others, ignoring order and spacing", () => {
    const header = `theme=dark;  ${SESSION_COOKIE}=abc123 ; other=1`;

    expect(readCookie(requestWith(header), SESSION_COOKIE)).toBe("abc123");
  });

  it("does not match a cookie whose name merely ends with this one", () => {
    // Otherwise `evil_bn_session` would authenticate.
    expect(
      readCookie(requestWith("evil_bn_session=abc"), SESSION_COOKIE),
    ).toBeNull();
  });

  it("reads an empty value as empty, not as absent", () => {
    // The difference matters on sign-out: an empty cookie is a session being
    // cleared, and treating it as absent hides the fact it was set at all.
    expect(readCookie(requestWith(`${SESSION_COOKIE}=`), SESSION_COOKIE)).toBe(
      "",
    );
  });

  it("returns null for a malformed percent-escape rather than throwing", () => {
    // A bad escape in a header should read as "no cookie", not take down the
    // request with a URIError from deep inside authentication.
    expect(
      readCookie(requestWith(`${SESSION_COOKIE}=%E0%A4%A`), SESSION_COOKIE),
    ).toBeNull();
  });

  it("decodes a percent-encoded value", () => {
    expect(
      readCookie(requestWith(`${SESSION_COOKIE}=a%2Fb`), SESSION_COOKIE),
    ).toBe("a/b");
  });
});
