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
    // are CPU-bound, not I/O-bound: bcryptjs is a pure-JavaScript implementation
    // and a cost-12 hash measures 616ms on an idle core but ~2.2s once three
    // other workers are hashing too (see the note in
    // src/modules/identity/password.ts), so a single test that builds a fixture
    // hash and then makes five sequential verifications is over 13s of pure
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
      // Components are still excluded, and the reason has changed: this is now a
      // deliberate, measured line rather than the absence of a way to test them.
      //
      // jsdom and @testing-library/react are installed and `tests/components/**`
      // runs under them, with `// @vitest-environment jsdom` per file. The first
      // suite through it — `pipeline-list.test.tsx` — found two defects the other
      // 73 files could not see, because both lived between a rendered button and a
      // callback that was correctly typed and correctly implemented: the inline
      // rename's "Save" discarded the edit, and its name field had no accessible
      // name at all.
      //
      // The exclusion stays because the remaining surface does not fit under the
      // existing thresholds yet. Measured with it removed: 63% lines against a 70%
      // threshold, with `src/components/ui` at 29.77% and twenty-two files at 0%.
      // Closing that is 251 covered lines, which is the Kanban board, the task
      // list, the task form, the notification bell, the command palette and the
      // activity timeline between them — real work, not a threshold to be
      // negotiated downwards to make the number go green.
      //
      // What the remaining thresholds do describe is the business logic — services,
      // guards, repositories — and they hold at 84% lines and 83% functions.
      exclude: [
        "src/**/*.d.ts",
        "src/**/index.ts",
        "src/app/**",
        "src/components/**",
        "src/proxy.ts",
      ],
      thresholds: {
        // Unchanged. These describe the business logic, which is what this
        // suite is specified to test.
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
