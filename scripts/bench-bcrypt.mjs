#!/usr/bin/env node

/**
 * bcrypt benchmark — bcryptjs vs native bcrypt at cost 12
 * Run with: node scripts/bench-bcrypt.mjs
 */

import os from "node:os";
import bcryptjs from "bcryptjs";

let bcryptNative;
try {
  bcryptNative = await import("bcrypt");
} catch {
  console.warn(
    "native bcrypt not installed, skipping native bcrypt comparison",
  );
}

const BCRYPT_COST = 12;
const ITERATIONS = 10;
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

  console.log(`  Average: ${avg.toFixed(2)} ms`);
  console.log(`  Min: ${min.toFixed(2)} ms`);
  console.log(`  Max: ${max.toFixed(2)} ms`);
  console.log(`  StdDev: ${stdDev.toFixed(2)} ms`);

  return { avg, min, max, stdDev, times };
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
  console.log(`CPU: ${os.cpus()[0].model}`);
  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`Cost factor: ${BCRYPT_COST}`);

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

  // Benchmark verify
  console.log("\n--- Verify benchmarks (using pre-computed hashes) ---");
  const bcryptjsHash = await bcryptjs.hash(TEST_PASSWORD, BCRYPT_COST);
  await benchmark("bcryptjs (verify)", () =>
    bcryptjs.compare(TEST_PASSWORD, bcryptjsHash),
  );

  if (bcryptNative) {
    const nativeHash = await bcryptNative.hash(TEST_PASSWORD, BCRYPT_COST);
    await benchmark("bcrypt (native) (verify)", () =>
      bcryptNative.compare(TEST_PASSWORD, nativeHash),
    );
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`bcryptjs hash avg: ${bcryptjsResults.avg.toFixed(2)} ms`);
  if (bcryptNativeResults) {
    console.log(
      `bcrypt (native) hash avg: ${bcryptNativeResults.avg.toFixed(2)} ms`,
    );
    const speedup = bcryptjsResults.avg / bcryptNativeResults.avg;
    console.log(`Speed ratio (js/native): ${speedup.toFixed(2)}x`);
  }
  console.log(
    "\nUse the bcryptjs hash average for docs (currently used in production).",
  );
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
