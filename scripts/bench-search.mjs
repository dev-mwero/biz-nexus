import { check, sleep } from "k6";
import http from "k6/http";
import { Rate, Trend } from "k6/metrics";

// Custom metrics
const searchLatency = new Trend("search_latency");
const searchErrors = new Rate("search_errors");

// Configuration - p95 < 300ms target
export const options = {
  scenarios: {
    search_load: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30s", target: 10 }, // Ramp up
        { duration: "1m", target: 10 }, // Sustained load
        { duration: "30s", target: 20 }, // Spike
        { duration: "1m", target: 20 }, // Sustained spike
        { duration: "30s", target: 0 }, // Ramp down
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    search_latency: ["p(95)<300"], // p95 < 300ms
    search_errors: ["rate<0.01"], // Error rate < 1%
    http_req_duration: ["p(95)<300"], // Overall p95 < 300ms
    http_req_failed: ["rate<0.01"], // Failed requests < 1%
  },
};

// Base URL
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Test data
const ORG_ID = __ENV.ORG_ID || "507f1f77bcf86cd799439011";
const USER_ID = __ENV.USER_ID || "507f1f77bcf86cd799439012";
const SESSION_COOKIE = __ENV.SESSION_COOKIE || "";

// Search queries to test - mix of common and edge cases
const SEARCH_QUERIES = [
  "john",
  "acme",
  "smith",
  "test",
  "lead",
  "proposal",
  "john doe",
  "acme corp",
  "new york",
  "enterprise",
  "a", // Too short - should be handled gracefully
  "verylongsearchquerythatmightexceednormalbounds",
  "user@domain.com",
  "555-1234",
  "john.smith",
];

export function setup() {
  const res = http.get(`${BASE_URL}/api/v1/crm/contacts?q=test`, {
    headers: {
      Cookie: `session=${SESSION_COOKIE}`,
      "x-organization-id": ORG_ID,
      "x-user-id": USER_ID,
    },
    timeout: "10s",
  });

  check(res, {
    "setup: search reachable": (r) => r.status === 200 || r.status === 400,
  });
  return { baseUrl: BASE_URL };
}

export default function (data) {
  // Pick a random query to simulate realistic search patterns
  const query =
    SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  const url = `${data.baseUrl}/api/v1/crm/contacts?q=${encodeURIComponent(query)}&pageSize=20`;

  const startTime = new Date();

  const res = http.get(url, {
    headers: {
      Cookie: `session=${SESSION_COOKIE}`,
      "x-organization-id": ORG_ID,
      "x-user-id": USER_ID,
      Accept: "application/json",
    },
    timeout: "10s",
    tags: { endpoint: "search", query: query.substring(0, 20) },
  });

  const latency = new Date() - startTime;
  searchLatency.add(latency);

  const success = check(res, {
    "status is 200": (r) => r.status === 200,
    "has data array": (r) => {
      try {
        const body = r.json();
        return Array.isArray(body.data);
      } catch {
        return false;
      }
    },
    "has meta pagination": (r) => {
      try {
        const body = r.json();
        return body.meta?.page !== undefined && body.meta?.total !== undefined;
      } catch {
        return false;
      }
    },
    "response time < 1000ms": (r) => r.timings.duration < 1000,
  });

  searchErrors.add(!success);

  // Realistic think time between searches
  sleep(Math.random() * 1 + 0.5);
}

export function handleSummary(data) {
  const p95 = (arr, percentile) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  };

  const latencies = data.metrics.search_latency?.values?.values || [];
  const p95Latency = p95(latencies, 95);
  const avgLatency =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

  console.log("\n=== Search Benchmark Summary ===");
  console.log(`Requests: ${data.metrics.http_reqs?.values?.count || 0}`);
  console.log(`Avg Latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`p95 Latency: ${p95Latency?.toFixed(2)}ms`);
  console.log(
    `Error Rate: ${(data.metrics.search_errors?.values?.rate * 100 || 0).toFixed(2)}%`,
  );
  console.log(
    `Threshold p95 < 300ms: ${p95Latency && p95Latency < 300 ? "PASS" : "FAIL"}`,
  );

  return {
    stdout: JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        benchmark: "search",
        target: "p95 < 300ms",
        results: {
          totalRequests: data.metrics.http_reqs?.values?.count || 0,
          avgLatencyMs: avgLatency,
          p95LatencyMs: p95Latency,
          errorRate: data.metrics.search_errors?.values?.rate || 0,
          passed: p95Latency && p95Latency < 300,
        },
      },
      null,
      2,
    ),
  };
}
