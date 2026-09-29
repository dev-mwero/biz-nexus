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
    testTimeout: 30_000,
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
