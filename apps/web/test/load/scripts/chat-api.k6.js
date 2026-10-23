import http from 'k6/http'
import { sleep } from 'k6'
import { BASE_URL, INTERNAL_KEY, loadOptions } from './lib/config.js'
import { validPayload } from './lib/payloads.js'
import { expectStatus } from './lib/checks.js'
import { expectCompleteStream } from './lib/ndjson.js'

// The analyze endpoint under load. The right Content-Type proves nothing on
// its own - a truncated or errored stream still carries it - so the body is
// what gets checked.

const ENDPOINT = `${BASE_URL}/api/chat/analyze/stream`
const MODELS = ['spark', 'flare']

// The rig answers from a mock backend, so its budget is milliseconds. A real
// inference stream takes seconds, so the target file carries the real budget.
const analyzeP95 = Number(__ENV.WEB_ANALYZE_P95_MS || 1000)
const analyzeP99 = Number(__ENV.WEB_ANALYZE_P99_MS || 2000)

export const options = loadOptions({
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'checks': ['rate>0.99'],
    'http_req_duration': [`p(95)<${analyzeP95}`, `p(99)<${analyzeP99}`],
    'dropped_iterations': ['count==0'],
  },
})

export default function () {
  const model = MODELS[__ITER % MODELS.length]

  const res = http.post(ENDPOINT, JSON.stringify(validPayload({ model })), {
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': INTERNAL_KEY,
    },
    tags: { model },
  })

  expectStatus(res, 200, `analyze(${model})`)
  expectCompleteStream(res, `analyze(${model})`)

  sleep(1)
}