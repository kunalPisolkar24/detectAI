import http from 'k6/http'
import { sleep } from 'k6'
import { BASE_URL, FREE_USER, PREMIUM_USER, loadOptions } from './lib/config.js'
import { login, logout } from './lib/auth.js'
import {
  expectStatus,
  expectSession,
  expectNoSession,
  expectPremiumSession,
  expectErrorBody,
  expectLoginAccepted,
  expectLoginRejected,
} from './lib/checks.js'

// The auth surface a client actually talks to. Registration is a server
// action, not an HTTP route, so what is load tested here is the NextAuth
// endpoints: the provider list, the CSRF token, the credentials callback and
// the session.

const PROVIDERS_URL = `${BASE_URL}/api/auth/providers`
const CSRF_URL = `${BASE_URL}/api/auth/csrf`
const SESSION_URL = `${BASE_URL}/api/auth/session`

// A body the callback refuses is the expected outcome for the malformed
// case, so 4xx counts as a healthy response here.
http.setResponseCallback(http.expectedStatuses(200, 302, 400))

// Credentials that must not authenticate.
const BAD_CREDENTIALS = [
  { label: 'unknown email', email: 'nobody@detectai.test', password: 'LoadTest123!' },
  { label: 'wrong password', email: FREE_USER.email, password: 'NotThePassword1!' },
  { label: 'malformed email', email: 'not-an-email', password: 'LoadTest123!' },
  { label: 'empty password', email: FREE_USER.email, password: '' },
]

export const options = loadOptions({
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'checks': ['rate>0.99'],
    'http_req_duration{endpoint:auth}': ['p(95)<1000', 'p(99)<2000'],
    'dropped_iterations': ['count==0'],
  },
})

export default function () {
  const providersRes = http.get(PROVIDERS_URL, { tags: { endpoint: 'auth' } })
  expectStatus(providersRes, 200, 'providers')

  const csrfRes = http.get(CSRF_URL, { tags: { endpoint: 'auth' } })
  expectStatus(csrfRes, 200, 'csrf')

  // The bad credentials come first: the jar starts every iteration empty,
  // and a good login later in the iteration would leave a session behind
  // for "no session" to be measured against.
  for (const bad of BAD_CREDENTIALS) {
    const { loginRes, sessionRes } = login(bad.email, bad.password)
    expectLoginRejected(loginRes, `login(${bad.label})`)
    expectNoSession(sessionRes, `login(${bad.label})`)
  }

  const malformedRes = http.post(
    `${BASE_URL}/api/auth/callback/credentials`,
    'not-json',
    { headers: { 'Content-Type': 'application/json' }, redirects: 0, tags: { endpoint: 'auth' } },
  )
  expectStatus(malformedRes, 400, 'login(malformed body)')
  expectErrorBody(malformedRes, 'Invalid JSON body', 'login(malformed body)')

  const afterFailures = http.get(SESSION_URL, { tags: { endpoint: 'auth' } })
  expectNoSession(afterFailures, 'session after failed logins')

  // The accounts the seeder created.
  for (const account of [FREE_USER, PREMIUM_USER]) {
    const { loginRes, sessionRes } = login(account.email, account.password)
    expectLoginAccepted(loginRes, `login(${account.email})`)
    expectSession(sessionRes, `login(${account.email})`)
  }

  const premium = login(PREMIUM_USER.email, PREMIUM_USER.password)
  expectPremiumSession(premium.sessionRes, 'premium login')

  // Signing out exercises the signout endpoint. The jar is emptied at the
  // start of every iteration anyway, so this is about the endpoint, not
  // about the cleanup.
  logout()

  sleep(1)
}