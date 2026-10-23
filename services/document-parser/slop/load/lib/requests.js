import http from "k6/http";
import { check } from "k6";
import { FormData } from "https://jslib.k6.io/formdata/0.0.2/index.js";

function toUploadData(data) {
  if (data === null || data === undefined) {
    return data;
  }
  if (typeof data === "string") {
    return data;
  }
  return new Uint8Array(data).buffer;
}

export function buildExtractBody(fixture) {
  const fd = new FormData();
  fd.append("file", {
    data: toUploadData(fixture.data),
    filename: fixture.filename,
    content_type: fixture.mime,
  });
  return fd;
}

export function postExtract({ baseUrl, fixture, timeout, metrics, scenario }) {
  const tags = {
    scenario,
    mime: fixture.mime,
    profile: fixture.profile,
    size: fixture.sizeBucket,
  };
  const fd = buildExtractBody(fixture);
  const body = fd.body();
  const headers = { "Content-Type": `multipart/form-data; boundary=${fd.boundary}` };
  const startedAt = Date.now();
  const res = http.post(`${baseUrl}/api/v1/extract`, body, {
    headers,
    timeout,
    tags,
  });
  const duration = Date.now() - startedAt;

  const passed = check(
    res,
    {
      "status is 200": (r) => r.status === 200,
      "has text content": (r) => {
        try {
          return r.json("text") !== undefined;
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
  if (res.status === 504 || res.timings.duration >= 30000) {
    metrics.timeouts.add(1, tags);
  }
  return { res, passed, duration };
}

export function postNegative({ baseUrl, payload, timeout, metrics, scenario }) {
  const tags = { scenario, case: payload.case };
  let res;
  if (payload.data === null) {
    res = http.post(`${baseUrl}/api/v1/extract`, {}, { timeout, tags });
  } else {
    const fd = new FormData();
    fd.append("file", {
      data: toUploadData(payload.data),
      filename: payload.filename,
      content_type: payload.mime,
    });
    const body = fd.body();
    const headers = { "Content-Type": `multipart/form-data; boundary=${fd.boundary}` };
    res = http.post(`${baseUrl}/api/v1/extract`, body, {
      headers,
      timeout,
      tags,
    });
  }

  const passed = check(
    res,
    {
      "rejected with expected status": (r) => payload.expectedStatuses.includes(r.status),
    },
    tags,
  );
  metrics.successRate.add(passed ? 1 : 0, tags);
  if (!passed) {
    metrics.failures.add(1, { ...tags, status: String(res.status) });
  }
  return { res, passed };
}

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
