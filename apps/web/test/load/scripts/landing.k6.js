import http from 'k6/http'
import { check, sleep } from 'k6'
import { BASE_URL, loadOptions } from './lib/config.js'
import { expectStatus } from './lib/checks.js'

// The landing page: the first thing a visitor hits, and the cheapest request
// the service serves.

export const options = loadOptions({
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'checks': ['rate>0.99'],
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'dropped_iterations': ['count==0'],
  },
})

export default function () {
  const res = http.get(BASE_URL, { tags: { endpoint: 'landing' } })

  expectStatus(res, 200, 'landing')
  check(res, {
    'landing serves an html page': (r) => String(r.headers['Content-Type'] || '').includes('text/html'),
  })

  sleep(1)
}