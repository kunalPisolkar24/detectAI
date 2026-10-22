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

const TARGETS = [
  { name: "document-parser", url: __ENV.API_URL, path: "/api/v1/health" },
];

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
    const res = http.get(url, { timeout: "3s" });
    const reachable = check(res, { [`${target.name} reachable`]: (r) => r.status === 200 });
    console.log(`${reachable ? "OK  " : "FAIL"} ${target.name} ${url} -> ${res.status}`);
  }
}
