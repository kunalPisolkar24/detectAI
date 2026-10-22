import http from 'k6/http'
import { sleep } from 'k6'
import { BASE_URL, PREMIUM_USER, loadOptions } from './lib/config.js'
import { validPayload } from './lib/payloads.js'
import { login } from './lib/auth.js'
import { expectStatus, expectSession, expectPremiumSession, expectRedirect } from './lib/checks.js'
import { expectCompleteStream } from './lib/ndjson.js'

// The analyze endpoint as a signed-in user sees it: a real NextAuth session
// instead of the internal load-test key. This is the path that runs the
// abuse limiter and the daily usage cap, so the seeded premium account is
// what keeps a long run from being throttled.

const ENDPOINT = `${BASE_URL}/api/chat/analyze/stream`

// The rig answers from a mock backend, so its budget is milliseconds. A real
// inference stream takes seconds, so the target file carries the real budget.
const analyzeP95 = Number(__ENV.WEB_ANALYZE_P95_MS || 2000)
const analyzeP99 = Number(__ENV.WEB_ANALYZE_P99_MS || 4000)

export const options = loadOptions({
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'checks': ['rate>0.99'],
    'http_req_duration{endpoint:analyze}': [`p(95)<${analyzeP95}`, `p(99)<${analyzeP99}`],
    'http_req_duration{endpoint:auth}': ['p(95)<1000', 'p(99)<2000'],
    'dropped_iterations': ['count==0'],
  },
})

export default function () {
  // k6 clears the per-VU cookie jar between iterations, so a session has to
  // be established in the same iteration that uses it. Signing in on every
  // iteration also puts the credential check - and the bcrypt work behind
  // it - under load.
  const { csrfRes, loginRes, sessionRes } = login(PREMIUM_USER.email, PREMIUM_USER.password)
  expectStatus(csrfRes, 200, 'csrf')
  expectRedirect(loginRes, 'credentials callback')
  expectSession(sessionRes, 'premium login')
  expectPremiumSession(sessionRes, 'premium login')

  const res = http.post(ENDPOINT, JSON.stringify(validPayload({ model: 'flare' })), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'analyze' },
  })

  expectStatus(res, 200, 'analyze(session)')
  expectCompleteStream(res, 'analyze(session)')

  sleep(1)
}
