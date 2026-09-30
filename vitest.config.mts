import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(process.cwd(), "src"),
      "@tests": resolve(process.cwd(), "tests"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    env: {
      // Silence rolldown's native-binding advisory. The binding is present
      // and working; the warning is emitted before any test code runs.
      VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
    },
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup-env.ts"],
    // An in-memory replica set boot plus connection setup is slower than a
    // default 5s. A timeout that is too tight produces flaky failures that get
    // retried into flakiness instead of being fixed.
    //
    // 60s rather than 30s, and for a second reason. The identity and auth suites
    // are CPU-bound, not I/O-bound: bcryptjs is a pure-JavaScript implementation
    // and a cost-12 hash measures ~2.1s on ordinary hardware (see the note in
    // src/modules/identity/password.ts), so a single test that builds a fixture
    // hash and then makes five sequential verifications is over 12s of pure
    // computation before any contention at all. Vitest runs one worker per test
    // file, this suite is 35 files, and on a 4-core machine those workers divide
    // the same four cores. 30s sat on that boundary and failed intermittently for
    // reasons that had nothing to do with the test.
    //
    // A patience limit, not a correctness one. It changes nothing any test
    // asserts, and nothing in the suite asserts a duration.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/index.ts",
        "src/app/**",
        "src/proxy.ts",
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
