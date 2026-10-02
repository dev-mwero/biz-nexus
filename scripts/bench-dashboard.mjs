import { check, sleep } from "k6";
import http from "k6/http";
import { Rate, Trend } from "k6/metrics";

// Custom metrics
const dashboardLatency = new Trend("dashboard_latency");
const dashboardErrors = new Rate("dashboard_errors");

// Configuration - p95 < 200ms target
export const options = {
  scenarios: {
    dashboard_load: {
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
    dashboard_latency: ["p(95)<200"], // p95 < 200ms
    dashboard_errors: ["rate<0.01"], // Error rate < 1%
    http_req_duration: ["p(95)<200"], // Overall p95 < 200ms
    http_req_failed: ["rate<0.01"], // Failed requests < 1%
  },
};

// Base URL - can be overridden via environment variable
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Test data - organization and user IDs for auth
const ORG_ID = __ENV.ORG_ID || "507f1f77bcf86cd799439011";
const USER_ID = __ENV.USER_ID || "507f1f77bcf86cd799439012";
const SESSION_COOKIE = __ENV.SESSION_COOKIE || "";

export function setup() {
  // Verify the API is reachable
  const res = http.get(`${BASE_URL}/api/v1/dashboard`, {
    headers: {
      Cookie: `session=${SESSION_COOKIE}`,
      "x-organization-id": ORG_ID,
      "x-user-id": USER_ID,
    },
    timeout: "10s",
  });

  check(res, { "setup: dashboard reachable": (r) => r.status === 200 });
  return { baseUrl: BASE_URL };
}

export default function (data) {
  const startTime = new Date();

  const res = http.get(`${data.baseUrl}/api/v1/dashboard`, {
    headers: {
      Cookie: `session=${SESSION_COOKIE}`,
      "x-organization-id": ORG_ID,
      "x-user-id": USER_ID,
      Accept: "application/json",
    },
    timeout: "10s",
    tags: { endpoint: "dashboard" },
  });

  const latency = new Date() - startTime;
  dashboardLatency.add(latency);

  const success = check(res, {
    "status is 200": (r) => r.status === 200,
    "has metricCards": (r) => {
      try {
        const body = r.json();
        return body.data?.metricCards !== undefined;
      } catch {
        return false;
      }
    },
    "has pipelineSummary": (r) => {
      try {
        const body = r.json();
        return Array.isArray(body.data?.pipelineSummary);
      } catch {
        return false;
      }
    },
    "response time < 500ms": (r) => r.timings.duration < 500,
  });

  dashboardErrors.add(!success);

  // Small sleep to simulate realistic user behavior
  sleep(Math.random() * 0.5 + 0.1);
}

export function handleSummary(data) {
  const p95 = (arr, percentile) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  };

  const latencies = data.metrics.dashboard_latency?.values?.values || [];
  const p95Latency = p95(latencies, 95);
  const avgLatency =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

  console.log("\n=== Dashboard Benchmark Summary ===");
  console.log(`Requests: ${data.metrics.http_reqs?.values?.count || 0}`);
  console.log(`Avg Latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`p95 Latency: ${p95Latency?.toFixed(2)}ms`);
  console.log(
    `Error Rate: ${(data.metrics.dashboard_errors?.values?.rate * 100 || 0).toFixed(2)}%`,
  );
  console.log(
    `Threshold p95 < 200ms: ${p95Latency && p95Latency < 200 ? "PASS" : "FAIL"}`,
  );

  return {
    stdout: JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        benchmark: "dashboard",
        target: "p95 < 200ms",
        results: {
          totalRequests: data.metrics.http_reqs?.values?.count || 0,
          avgLatencyMs: avgLatency,
          p95LatencyMs: p95Latency,
          errorRate: data.metrics.dashboard_errors?.values?.rate || 0,
          passed: p95Latency && p95Latency < 200,
        },
      },
      null,
      2,
    ),
  };
}
