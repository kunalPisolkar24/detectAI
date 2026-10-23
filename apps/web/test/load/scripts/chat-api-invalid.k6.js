import http from 'k6/http'
import { sleep } from 'k6'
import { BASE_URL, INTERNAL_KEY, loadOptions } from './lib/config.js'
import { ALL_CASES } from './lib/payloads.js'
import { expectStatus, expectErrorBody } from './lib/checks.js'

// The analyze endpoint must reject the bodies it does not accept, and say why.
// Every case in the matrix is cycled through, so a run covers all of them.

const ENDPOINT = `${BASE_URL}/api/chat/analyze/stream`

// Rejections are the expected outcome, so 4xx counts as a healthy response.
// Anything outside this set - a 5xx, a timeout - still fails the request.
http.setResponseCallback(http.expectedStatuses(200, 400, 401, 405))

// The boundary cases are valid payloads, so they reach the backend the way a
// real analyze does. The rig answers from a mock, so its budget is
// milliseconds; the target file carries the real one.
const boundaryP95 = Number(__ENV.WEB_ANALYZE_P95_MS || 2000)
const boundaryP99 = Number(__ENV.WEB_ANALYZE_P99_MS || 4000)

export const options = loadOptions({
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'checks': ['rate>0.99'],
    // A rejection should be cheaper than the work that actually runs.
    'http_req_duration{group:invalid}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{group:boundary}': [`p(95)<${boundaryP95}`, `p(99)<${boundaryP99}`],
    'dropped_iterations': ['count==0'],
  },
})

export default function () {
  const testCase = ALL_CASES[__ITER % ALL_CASES.length]
  const body = testCase.raw !== undefined ? testCase.raw : JSON.stringify(testCase.payload)

  const headers = { 'Content-Type': 'application/json' }
  if (!testCase.omitInternalKey) {
    headers['X-Internal-Key'] = testCase.internalKey || INTERNAL_KEY
  }

  const params = { headers, tags: { group: testCase.group } }
  const res =
    testCase.method === 'GET'
      ? http.get(ENDPOINT, params)
      : http.post(ENDPOINT, body, params)

  expectStatus(res, testCase.expectedStatus, testCase.name)
  if (testCase.expectError) {
    expectErrorBody(res, testCase.expectError, testCase.name)
  }

  sleep(0.1)
}