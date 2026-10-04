#!/usr/bin/env node

/**
 * bcrypt benchmark — bcryptjs vs native bcrypt at cost 12
 * Run with: node scripts/bench-bcrypt.mjs [iterations] [concurrency]
 *
 * Task 1.78. The cost factor is held at 12 on both sides because that pin is a
 * correctness decision, not a performance knob; what is under comparison is the
 * implementation.
 *
 * Two numbers are reported for each library and they answer different questions.
 *
 * The serial figures are what one sign-in costs on an idle machine, which is
 * what a rate limiter is sized against. The concurrent figures run the same work
 * in parallel across `concurrency` loops — one per core by default — because
 * that is what the test runner does, and it is why this repository's own
 * fixtures observe roughly three times the idle figure for the same hash. A
 * single number cannot be both, and quoting only the idle one would make the
 * suite look ten times slower than it is.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import bcryptjs from "bcryptjs";

/**
 * The versions in the tree, printed, because a timing without them is not a
 * measurement of anything reproducible. bcryptjs 2.x and 3.x differ by more than
 * a factor of two on the same hardware at the same cost, and this repository's
 * documentation carried a figure from the older one for months.
 *
 * Read off disk rather than through `require("bcryptjs/package.json")`: bcryptjs
 * 3 declares an `exports` map that does not include its own manifest, so the
 * require throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 */
const require = createRequire(import.meta.url);

function installedVersion(name) {
  const manifest = require.resolve(name).split("/").slice(0, -1);
  // Scoped packages resolve one directory deeper than the manifest's own name.
  if (name.startsWith("@")) manifest.pop();
  return JSON.parse(
    readFileSync([...manifest, "package.json"].join("/"), "utf8"),
  ).version;
}

const bcryptjsVersion = installedVersion("bcryptjs");

let bcryptNative;
let bcryptNativeVersion;
try {
  bcryptNative = await import("bcrypt");
  bcryptNativeVersion = installedVersion("bcrypt");
} catch {
  console.warn(
    "native bcrypt not installed, skipping native bcrypt comparison",
  );
}

const BCRYPT_COST = 12;
const ITERATIONS = Number(process.argv[2] ?? 10);
const CONCURRENCY = Number(process.argv[3] ?? os.cpus().length);
const TEST_PASSWORD = "correct horse battery staple";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function benchmark(name, fn, iterations = ITERATIONS) {
  const times = [];
  console.log(`\n${name} (${iterations} iterations):`);

  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    await fn();
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1_000_000;
    times.push(ms);
    console.log(`  Iteration ${i + 1}: ${ms.toFixed(2)} ms`);
    await sleep(10);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const variance =
    times.reduce((sum, t) => sum + (t - avg) ** 2, 0) / times.length;
  const stdDev = Math.sqrt(variance);
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  console.log(`  Average: ${avg.toFixed(2)} ms`);
  console.log(`  Median:  ${median.toFixed(2)} ms`);
  console.log(`  Min: ${min.toFixed(2)} ms`);
  console.log(`  Max: ${max.toFixed(2)} ms`);
  console.log(`  StdDev: ${stdDev.toFixed(2)} ms`);

  return { avg, median, min, max, stdDev, times };
}

/**
 * The same work in parallel, which is what the test runner does.
 *
 * A cost-12 hash is CPU-bound and single-threaded, so N of them on N cores take
 * roughly as long as one. The interesting number is what happens when N exceeds
 * the core count: that is the shape of `vitest run`, one worker per file, all of
 * them calling `hashPassword` for a fixture, and it is where this repository's
 * "~2.1s per hash" observations come from.
 */
async function benchmarkConcurrent(name, fn, lanes = CONCURRENCY) {
  const wall = [];
  console.log(`\n${name} (${lanes} concurrent, ${ITERATIONS} iterations):`);

  for (let i = 0; i < ITERATIONS; i++) {
    const start = process.hrtime.bigint();
    await Promise.all(Array.from({ length: lanes }, () => fn()));
    const end = process.hrtime.bigint();
    wall.push(Number(end - start) / 1_000_000);
    console.log(
      `  Round ${i + 1}: ${wall[wall.length - 1].toFixed(2)} ms wall`,
    );
    await sleep(10);
  }

  const avg = wall.reduce((a, b) => a + b, 0) / wall.length;
  const median = [...wall].sort((a, b) => a - b)[Math.floor(wall.length / 2)];

  console.log(`  Wall average: ${avg.toFixed(2)} ms for ${lanes} hashes`);
  console.log(`  Wall median:  ${median.toFixed(2)} ms`);
  console.log(`  Per hash:     ${(median / lanes).toFixed(2)} ms`);

  return { avg, median, lanes };
}

async function verifyHash(name, hashFn, verifyFn) {
  console.log(`\nVerifying ${name}...`);
  const hash = await hashFn(TEST_PASSWORD);
  const valid = await verifyFn(TEST_PASSWORD, hash);
  const invalid = await verifyFn("wrong password", hash);
  console.log(`  Hash: ${hash.slice(0, 30)}...`);
  console.log(`  Valid password: ${valid ? "PASS" : "FAIL"}`);
  console.log(`  Invalid password: ${invalid ? "FAIL" : "PASS"}`);
  return valid && !invalid;
}

async function main() {
  console.log("=".repeat(60));
  console.log("bcrypt Benchmark — Cost 12");
  console.log("=".repeat(60));
  console.log(`Node.js: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`CPU: ${os.cpus()[0].model} (${os.cpus().length} cores)`);
  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Cost factor: ${BCRYPT_COST}`);
  console.log(`bcryptjs: ${bcryptjsVersion}`);
  if (bcryptNative) console.log(`bcrypt (native): ${bcryptNativeVersion}`);

  // Warm-up
  console.log("\nWarming up...");
  await bcryptjs.hash(TEST_PASSWORD, BCRYPT_COST);
  if (bcryptNative) await bcryptNative.hash(TEST_PASSWORD, BCRYPT_COST);

  // Benchmark bcryptjs
  const bcryptjsResults = await benchmark("bcryptjs (hash)", () =>
    bcryptjs.hash(TEST_PASSWORD, BCRYPT_COST),
  );
  await verifyHash(
    "bcryptjs",
    (p) => bcryptjs.hash(p, BCRYPT_COST),
    bcryptjs.compare,
  );

  // Benchmark native bcrypt if available
  let bcryptNativeResults = null;
  if (bcryptNative) {
    bcryptNativeResults = await benchmark("bcrypt (native) (hash)", () =>
      bcryptNative.hash(TEST_PASSWORD, BCRYPT_COST),
    );
    await verifyHash(
      "bcrypt (native)",
      (p) => bcryptNative.hash(p, BCRYPT_COST),
      bcryptNative.compare,
    );
  }

  // Verify
  console.log("\n--- Verify benchmarks (using pre-computed hashes) ---");
  const bcryptjsHash = await bcryptjs.hash(TEST_PASSWORD, BCRYPT_COST);
  const bcryptjsVerify = await benchmark("bcryptjs (verify)", () =>
    bcryptjs.compare(TEST_PASSWORD, bcryptjsHash),
  );

  let bcryptNativeVerify = null;
  if (bcryptNative) {
    const nativeHash = await bcryptNative.hash(TEST_PASSWORD, BCRYPT_COST);
    bcryptNativeVerify = await benchmark("bcrypt (native) (verify)", () =>
      bcryptNative.compare(TEST_PASSWORD, nativeHash),
    );
  }

  // Concurrent, which is the shape of the test suite.
  console.log(`\n--- Concurrent hash, ${CONCURRENCY} lanes (one per core) ---`);
  const bcryptjsConcurrent = await benchmarkConcurrent("bcryptjs (hash)", () =>
    bcryptjs.hash(TEST_PASSWORD, BCRYPT_COST),
  );
  const bcryptNativeConcurrent = bcryptNative
    ? await benchmarkConcurrent("bcrypt (native) (hash)", () =>
        bcryptNative.hash(TEST_PASSWORD, BCRYPT_COST),
      )
    : null;

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log("=".repeat(60));

  const rows = [
    ["bcryptjs hash", bcryptjsResults.median],
    ["bcryptjs verify", bcryptjsVerify.median],
    ...(bcryptNativeResults
      ? [
          ["bcrypt (native) hash", bcryptNativeResults.median],
          ["bcrypt (native) verify", bcryptNativeVerify.median],
        ]
      : []),
  ];

  console.log("Serial, idle machine (median of " + ITERATIONS + "):");
  for (const [label, ms] of rows) {
    console.log(`  ${label.padEnd(24)} ${ms.toFixed(0)} ms`);
  }

  if (bcryptNativeResults) {
    console.log(
      `\n  bcryptjs is ${(bcryptjsResults.median / bcryptNativeResults.median).toFixed(2)}x the cost of native bcrypt per hash`,
    );
  }

  console.log(
    `\nConcurrent, ${CONCURRENCY} lanes (per-hash median of the wall time):`,
  );
  console.log(
    `  bcryptjs hash            ${(bcryptjsConcurrent.median / bcryptjsConcurrent.lanes).toFixed(0)} ms`,
  );
  if (bcryptNativeConcurrent) {
    console.log(
      `  bcrypt (native) hash     ${(bcryptNativeConcurrent.median / bcryptNativeConcurrent.lanes).toFixed(0)} ms`,
    );
  }

  console.log(
    "\nDocs quote the serial figure for a sign-in and the concurrent figure for the suite.",
  );
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
