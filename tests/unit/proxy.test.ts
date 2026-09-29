/**
 * Proxy tests.
 *
 * Unit, not integration: the proxy must never open a database connection, and
 * that is asserted directly below rather than inferred from a passing test. A
 * regression that reached for Mongoose would be caught by the import test
 * instead of by some unrelated timeout.
 */

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "@/proxy";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

function request(path: string, options: { cookie?: string } = {}): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  const req = new NextRequest(url);
  if (options.cookie !== undefined) {
    req.cookies.set(SESSION_COOKIE, options.cookie);
  }
  return req;
}

function location(response: Response): string {
  return response.headers.get("location") ?? "";
}

describe("proxy", () => {
  describe("protected paths without a session cookie", () => {
    it("redirects a protected page to sign-in", () => {
      const response = proxy(request("/app"));
      expect(response.status).toBe(307);
      expect(location(response)).toBe(
        "http://localhost:3000/sign-in?next=%2Fapp",
      );
    });

    it("preserves where the visitor was headed", () => {
      const response = proxy(request("/deals/42"));
      expect(location(response)).toBe(
        "http://localhost:3000/sign-in?next=%2Fdeals%2F42",
      );
    });

    it("does not treat a prefix-lookalike as protected", () => {
      // "/appetite" starts with "/app" as a string. Matching on startsWith alone
      // would redirect a public path, and the visitor could never reach it.
      expect(proxy(request("/appetite")).status).toBe(200);
    });
  });

  describe("paths that are not protected", () => {
    it("passes the marketing home page through", () => {
      expect(proxy(request("/")).status).toBe(200);
    });

    it("passes an unprotected page through", () => {
      expect(proxy(request("/pricing")).status).toBe(200);
    });

    it("passes the sign-in page through when there is no cookie", () => {
      expect(proxy(request("/sign-in")).status).toBe(200);
    });
  });

  describe("existing session cookie", () => {
    it("lets a protected page through", () => {
      // The whole point of the word "optimistic": presence is believed. The DAL
      // is what verifies the value, and a forged cookie proves nothing.
      expect(proxy(request("/app", { cookie: "anything" })).status).toBe(200);
    });

    it("redirects an auth page to the dashboard", () => {
      const response = proxy(request("/sign-in", { cookie: "anything" }));
      expect(response.status).toBe(307);
      expect(location(response)).toBe("http://localhost:3000/app");
    });

    it("honours a safe next parameter on the way in", () => {
      const response = proxy(
        request("/sign-in?next=%2Fdeals", { cookie: "x" }),
      );
      expect(location(response)).toBe("http://localhost:3000/deals");
    });
  });

  describe("open redirect", () => {
    const attempts = [
      "https://evil.example/steal",
      "//evil.example/steal",
      "/\\evil.example",
      "javascript:alert(1)",
      "app",
      "",
    ];

    for (const attempt of attempts) {
      it(`refuses ${JSON.stringify(attempt)}`, () => {
        const response = proxy(
          request(`/sign-in?next=${encodeURIComponent(attempt)}`, {
            cookie: "anything",
          }),
        );
        // Falls back to the default rather than honouring the parameter, and
        // never leaves this origin.
        expect(location(response)).toBe("http://localhost:3000/app");
      });
    }
  });

  describe("matcher", () => {
    it("excludes the API so callers get JSON, not an HTML sign-in page", () => {
      const [matcher] = config.matcher;
      expect(new RegExp(`^${matcher}$`).test("/api/v1/deals")).toBe(false);
    });

    it("excludes static assets so stylesheets are never redirected", () => {
      const [matcher] = config.matcher;
      const pattern = new RegExp(`^${matcher}$`);
      expect(pattern.test("/_next/static/chunk.js")).toBe(false);
      expect(pattern.test("/_next/image")).toBe(false);
      expect(pattern.test("/favicon.ico")).toBe(false);
      expect(pattern.test("/logo.png")).toBe(false);
    });

    it("still covers page routes", () => {
      const [matcher] = config.matcher;
      const pattern = new RegExp(`^${matcher}$`);
      expect(pattern.test("/app")).toBe(true);
      expect(pattern.test("/deals/42")).toBe(true);
    });
  });

  describe("dependency graph", () => {
    it("never reaches a database client", async () => {
      // The rule is "no DB access", and an import of mongoose is DB access.
      // Read the source rather than trusting a comment.
      const source = await import("node:fs/promises").then((fs) =>
        fs.readFile(new URL("../../src/proxy.ts", import.meta.url), "utf8"),
      );
      expect(source).not.toMatch(/from ["']mongoose["']/);
      expect(source).not.toMatch(/@\/db\//);
      expect(source).not.toMatch(/@\/shared\/auth\/dal/);
    });
  });
});
