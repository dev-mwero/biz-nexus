import { check, sleep } from "k6";
import http from "k6/http";
import { Rate, Trend } from "k6/metrics";

// Custom metrics
const listLatency = new Trend("list_latency");
const listErrors = new Rate("list_errors");

// Configuration - p95 < 150ms target
export const options = {
  scenarios: {
    list_load: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30s", target: 15 }, // Ramp up
        { duration: "1m", target: 15 }, // Sustained load
        { duration: "30s", target: 30 }, // Spike
        { duration: "1m", target: 30 }, // Sustained spike
        { duration: "30s", target: 0 }, // Ramp down
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    list_latency: ["p(95)<150"], // p95 < 150ms
    list_errors: ["rate<0.01"], // Error rate < 1%
    http_req_duration: ["p(95)<150"], // Overall p95 < 150ms
    http_req_failed: ["rate<0.01"], // Failed requests < 1%
  },
};

// Base URL
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Test data
const ORG_ID = __ENV.ORG_ID || "507f1f77bcf86cd799439011";
const USER_ID = __ENV.USER_ID || "507f1f77bcf86cd799439012";
const SESSION_COOKIE = __ENV.SESSION_COOKIE || "";

// Endpoints to test - round-robin for realistic load
const ENDPOINTS = [
  { path: "/api/v1/crm/contacts", name: "contacts", params: "pageSize=20" },
  { path: "/api/v1/crm/leads", name: "leads", params: "pageSize=20" },
  { path: "/api/v1/crm/companies", name: "companies", params: "pageSize=20" },
  {
    path: "/api/v1/crm/contacts",
    name: "contacts_sorted",
    params: "pageSize=20&sort=-createdAt",
  },
  {
    path: "/api/v1/crm/leads",
    name: "leads_sorted",
    params: "pageSize=20&sort=-createdAt",
  },
  {
    path: "/api/v1/crm/contacts",
    name: "contacts_page2",
    params: "pageSize=20&page=2",
  },
  {
    path: "/api/v1/crm/leads",
    name: "leads_filtered",
    params: "pageSize=20&status=NEW",
  },
];

export function setup() {
  const res = http.get(`${BASE_URL}/api/v1/crm/contacts?pageSize=5`, {
    headers: {
      Cookie: `session=${SESSION_COOKIE}`,
      "x-organization-id": ORG_ID,
      "x-user-id": USER_ID,
    },
    timeout: "10s",
  });

  check(res, { "setup: list reachable": (r) => r.status === 200 });
  return { baseUrl: BASE_URL };
}

let endpointIndex = 0;

export default function (data) {
  // Round-robin through endpoints
  const endpoint = ENDPOINTS[endpointIndex % ENDPOINTS.length];
  endpointIndex++;

  const url = `${data.baseUrl}${endpoint.path}?${endpoint.params}`;

  const startTime = new Date();

  const res = http.get(url, {
    headers: {
      Cookie: `session=${SESSION_COOKIE}`,
      "x-organization-id": ORG_ID,
      "x-user-id": USER_ID,
      Accept: "application/json",
    },
    timeout: "10s",
    tags: { endpoint: endpoint.name },
  });

  const latency = new Date() - startTime;
  listLatency.add(latency);

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
    "response time < 500ms": (r) => r.timings.duration < 500,
  });

  listErrors.add(!success);

  // Very short think time for list APIs
  sleep(Math.random() * 0.3 + 0.05);
}

export function handleSummary(data) {
  const p95 = (arr, percentile) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  };

  const latencies = data.metrics.list_latency?.values?.values || [];
  const p95Latency = p95(latencies, 95);
  const avgLatency =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

  // Per-endpoint breakdown
  const endpointMetrics = {};
  for (const ep of ENDPOINTS) {
    const epLatencies =
      data.metrics[`http_req_duration{endpoint:${ep.name}}`]?.values?.values ||
      [];
    if (epLatencies.length > 0) {
      endpointMetrics[ep.name] = {
        avg: epLatencies.reduce((a, b) => a + b, 0) / epLatencies.length,
        p95: p95(epLatencies, 95),
        count: epLatencies.length,
      };
    }
  }

  console.log("\n=== CRM List API Benchmark Summary ===");
  console.log(`Requests: ${data.metrics.http_reqs?.values?.count || 0}`);
  console.log(`Avg Latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`p95 Latency: ${p95Latency?.toFixed(2)}ms`);
  console.log(
    `Error Rate: ${(data.metrics.list_errors?.values?.rate * 100 || 0).toFixed(2)}%`,
  );
  console.log(
    `Threshold p95 < 150ms: ${p95Latency && p95Latency < 150 ? "PASS" : "FAIL"}`,
  );
  console.log("\nPer-endpoint breakdown:");
  for (const [name, metrics] of Object.entries(endpointMetrics)) {
    console.log(
      `  ${name}: avg=${metrics.avg.toFixed(2)}ms p95=${metrics.p95.toFixed(2)}ms (${metrics.count} reqs)`,
    );
  }

  return {
    stdout: JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        benchmark: "crm-list",
        target: "p95 < 150ms",
        results: {
          totalRequests: data.metrics.http_reqs?.values?.count || 0,
          avgLatencyMs: avgLatency,
          p95LatencyMs: p95Latency,
          errorRate: data.metrics.list_errors?.values?.rate || 0,
          passed: p95Latency && p95Latency < 150,
          perEndpoint: endpointMetrics,
        },
      },
      null,
      2,
    ),
  };
}
