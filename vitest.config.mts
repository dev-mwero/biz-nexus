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
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup-env.ts"],
    // An in-memory replica set boot plus connection setup is slower than a
    // default 5s. A timeout that is too tight produces flaky failures that get
    // retried into flakiness instead of being fixed.
    //
    // 60s rather than 30s, and for a second reason. The identity and auth suites
    // are CPU-bound, not I/O-bound: a native cost-12 hash measures 334ms on an
    // idle core and occupies a libuv threadpool lane rather than the event loop,
    // so four concurrent hashes still cost ~440ms each (see the note in
    // src/modules/identity/password.ts). A single test that builds a fixture
    // hash and then makes five sequential verifications is still seconds of pure
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
      // Components are in the gate. They were excluded while the surface had no
      // DOM suites at all, and the exclusion was lifted once the suites that
      // cover them existed — the tests came first, the threshold followed.
      //
      // jsdom and @testing-library/react run these suites, one per file under
      // `tests/components/**` with `// @vitest-environment jsdom`. Two defects
      // came out of writing them that no other layer could see:
      //
      // - `PipelineList`'s inline rename discarded the edit, and its name field
      //   had no accessible name.
      // - A form-level `<FieldError>` sat outside any `<Field>` in three forms.
      //   Base UI's error part reads its context and throws without one, so a
      //   rejected save unmounted the entire form instead of showing why. That
      //   is now `FormError`, and `task-form.test.tsx` is the test that noticed.
      //
      // Both were reachable only from the DOM: correctly typed, correctly
      // implemented against the API, and invisible to every service test.
      //
      // Measured with the exclusion lifted: 73.17% lines / 70.46% functions /
      // 65.09% branches. The remaining gap is concentrated in the shell — the
      // command palette, the activity timeline and the task list — which is
      // where the next component suites belong.
      exclude: [
        "src/**/*.d.ts",
        "src/**/index.ts",
        "src/app/**",
        "src/proxy.ts",
      ],
      thresholds: {
        // Raised with the exclusion lifted, and set below the measured values
        // rather than at them: a threshold pinned to the exact number fails on
        // the next unrelated refactor and teaches people to lower it.
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
