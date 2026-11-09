import http from "k6/http";
import { check } from "k6";

// Every queued probe asserts the exact acknowledgement: a signed post on
// the paddle route answers 200 {"status":"queued"}, and anything else is a
// metric-recorded failure.
export function postQueued({ baseUrl, request, timeout, timeoutMs, metrics, scenario }) {
  const tags = { scenario, profile: request.profile, event_type: request.eventType };
  const headers = {
    "Content-Type": "application/json",
    "Paddle-Signature": request.signature,
  };
  const startedAt = Date.now();
  const res = http.post(`${baseUrl}/api/v1/webhook/paddle`, request.body, {
    headers,
    timeout,
    tags,
  });
  const duration = Date.now() - startedAt;

  const passed = check(
    res,
    {
      "status is 200": (r) => r.status === 200,
      "acknowledges queued": (r) => {
        try {
          return r.json("status") === "queued";
        } catch (_e) {
          return false;
        }
      },
    },
    tags,
  );

  metrics.duration.add(duration, tags);
  metrics.successRate.add(passed ? 1 : 0, tags);
  if (!passed) {
    metrics.failures.add(1, { ...tags, status: String(res.status) });
  }
  if (res.status === 0 || duration >= timeoutMs) {
    metrics.timeouts.add(1, tags);
  }
  return { res, passed, duration };
}

// A rejection case asserts its route-verdict exactly; an explicit signature
// rides its own header, and its absence is the missing-Signature class.
export function postRejected({ baseUrl, request, timeout, metrics, scenario }) {
  const tags = { scenario, case: request.case };
  const headers = {};
  if (request.signature) {
    headers["Paddle-Signature"] = request.signature;
  }
  const res = http.post(`${baseUrl}/api/v1/webhook/paddle`, request.body, {
    headers,
    timeout,
    tags,
  });

  const passed = check(
    res,
    {
      "rejected with expected status": (r) => r.status === request.expected,
    },
    tags,
  );
  metrics.successRate.add(passed ? 1 : 0, tags);
  if (!passed) {
    metrics.failures.add(1, { ...tags, status: String(res.status) });
  }
  return { res, passed };
}

// Readiness rides the load run as backpressure bookkeeping; a 503 is a
// not-ready tick, not a check failure.
export function checkReadiness({ baseUrl, timeout, metrics, scenario }) {
  const tags = { scenario };
  const res = http.get(`${baseUrl}/api/v1/ready`, { timeout, tags });
  metrics.checks.add(1, tags);
  const ok = res.status === 200;
  if (!ok) {
    metrics.notReady.add(1, { ...tags, status: String(res.status) });
  }
  check(res, { "readiness reachable": (r) => r.status === 200 || r.status === 503 }, tags);
  return { res, ready: ok };
}

export function checkHealth({ baseUrl, timeout, scenario }) {
  const tags = { scenario };
  const res = http.get(`${baseUrl}/api/v1/health`, { timeout, tags });
  return check(
    res,
    {
      "status is 200": (r) => r.status === 200,
      "status is ok": (r) => {
        try {
          return r.json("status") === "ok";
        } catch (_e) {
          return false;
        }
      },
    },
    tags,
  );
}
