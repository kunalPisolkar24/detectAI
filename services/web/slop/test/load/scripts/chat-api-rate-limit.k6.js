import http from 'k6/http'
import { check } from 'k6'
import { BASE_URL, FREE_USER } from './lib/config.js'
import { validPayload } from './lib/payloads.js'
import { login } from './lib/auth.js'
import { expectSession } from './lib/checks.js'

// The rejection contract of the analyze endpoint. Two limiters stand in
// front of it and they need different settings to be observed:
//
//   - the abuse limiter caps how many requests one account may make in a
//     window. The rig runs this scenario with the cap lowered to a handful
//     of requests so the limiter itself is the one that refuses, and it
//     answers 429 with Retry-After and RateLimit-Remaining.
//   - the daily cap allows a free account 100 analyses a day. The rig runs
//     the scenario with the abuse limiter out of the way so the daily cap
//     is the only limiter standing, and it answers 429 with a plain body
//     and no headers.
//
// Both counters belong to the account, not to the connection, so the
// scenario is serial: one VU, one iteration.

const ENDPOINT = `${BASE_URL}/api/chat/analyze/stream`
const DAILY_ALLOWANCE = 100
const ABUSE_ALLOWANCE = 5

const RATE_LIMIT_CASE = __ENV.RATE_LIMIT_CASE || 'abuse'

// A refusal is the expected outcome for the last requests of the run. The
// response callback replaces k6's default set, so the redirect the
// credentials callback answers with has to be in it as well.
http.setResponseCallback(http.expectedStatuses(200, 302, 429))

export const options = {
  scenarios: {
    rate_limit: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '10m',
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.05'],
    'checks': ['rate>0.99'],
  },
}

export default function () {
  const { sessionRes } = login(FREE_USER.email, FREE_USER.password)
  expectSession(sessionRes, 'free login')

  const allowance = RATE_LIMIT_CASE === 'daily' ? DAILY_ALLOWANCE : ABUSE_ALLOWANCE

  let allowed = 0
  let refusal = null

  for (let attempt = 0; attempt < allowance + 50; attempt += 1) {
    const res = http.post(ENDPOINT, JSON.stringify(validPayload()), {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'analyze' },
    })

    if (res.status === 200) {
      allowed += 1
      continue
    }

    refusal = res
    break
  }

  check(refusal, {
    'the limiter refuses once the allowance is used': (r) => !!r && r.status === 429,
  })

  if (RATE_LIMIT_CASE === 'daily') {
    check(allowed, {
      [`the free account gets ${allowance} requests through`]: (n) => n === allowance,
    })
    check((refusal && refusal.body) || '', {
      'the daily cap says the rate limit was exceeded': (b) => b.includes('Rate limit exceeded'),
    })
    check((refusal && refusal.headers) || {}, {
      'the daily cap carries no retry hint': (h) => h['Retry-After'] === undefined,
    })
    return
  }

  // The abuse limiter counts in fixed windows, so a window that rolls over
  // during the run lets one more request through before it refuses.
  check(allowed, {
    [`the account gets at most ${allowance + 1} requests through`]: (n) => n <= allowance + 1,
  })
  // The header names arrive canonicalised, so the rate limit headers are
  // "Ratelimit-Remaining" rather than "RateLimit-Remaining".
  const headers = (refusal && refusal.headers) || {}
  check(headers, {
    'the refusal carries Retry-After': (h) => typeof h['Retry-After'] === 'string',
    'the refusal reports the limit it applied': (h) => h['Ratelimit-Limit'] === String(allowance),
    'the refusal reports no remaining requests': (h) => h['Ratelimit-Remaining'] === '0',
  })
  check((refusal && refusal.body) || '', {
    'the refusal says too many requests': (b) => b.includes('Too many requests'),
  })
}
