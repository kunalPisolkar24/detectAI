// Reachability check for every configured target.
//
// Runs before a load test so "the target is down" is distinguishable from
// "the service is broken". The URL comes from the target file
// (targets/.env.<target>) and the path is that service's health endpoint.
//
// A service with no URL configured is skipped: the harness runs whatever is
// wired up, and an environment that has not been pointed at a service yet is
// not a failure.

import http from "k6/http";
import { check } from "k6";
import encoding from "k6/encoding";

const TARGETS = [
  { name: "document-parser", url: __ENV.API_URL, path: "/api/v1/health" },
  // /readyz also reports the broker connection: it answers 503 with
  // {"rabbitmq":"disconnected"} when the gateway cannot reach RabbitMQ.
  { name: "payment-gateway", url: __ENV.GATEWAY_BASE_URL, path: "/readyz" },
  // The chat service and its worker. The worker is what persists a message,
  // so the end-to-end check needs one even though the API is what answers.
  { name: "chats", url: __ENV.CHAT_METRICS_URL, path: "/metrics" },
  { name: "chat-worker", url: __ENV.CHAT_WORKER_METRICS_URL, path: "/metrics" },
  // The landing page: the cheapest thing the app serves.
  { name: "web", url: __ENV.WEB_BASE_URL, path: "/" },
];

// The broker's management API is part of the delivery proof only when the
// queue depth is compared. With "off" the proof comes from the gateway's own
// publish counters, and the management API may not be exposed at all.
if ((__ENV.GATEWAY_LOAD_QUEUE_PROOF || "exact").toLowerCase() !== "off") {
  TARGETS.push({
    name: "payment-gateway rabbitmq",
    url: __ENV.RABBITMQ_MGMT_URL,
    path: `/api/queues/%2F/${__ENV.RABBITMQ_QUEUE || "payment_events"}`,
    user: __ENV.RABBITMQ_USER,
    pass: __ENV.RABBITMQ_PASS,
  });
}

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ["rate==1"],
  },
};

export default function () {
  for (const target of TARGETS) {
    if (!target.url) {
      console.log(`SKIP ${target.name} (no URL configured)`);
      continue;
    }

    const url = `${target.url.replace(/\/+$/, "")}${target.path}`;
    const params = { timeout: "3s" };
    if (target.user) {
      params.headers = {
        Authorization: `Basic ${encoding.b64encode(`${target.user}:${target.pass || ""}`)}`,
      };
    }

    const res = http.get(url, params);
    const reachable = check(res, { [`${target.name} reachable`]: (r) => r.status === 200 });
    console.log(`${reachable ? "OK  " : "FAIL"} ${target.name} ${url} -> ${res.status}`);
  }
}
