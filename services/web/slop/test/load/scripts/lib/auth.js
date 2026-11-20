import http from 'k6/http'
import { BASE_URL } from './config.js'

/**
 * NextAuth's credentials flow: read the CSRF token, post it back with the
 * credentials, then read the session the callback set. k6 keeps cookies per
 * VU, so the session cookie the callback writes rides along on the requests
 * that follow.
 *
 * The callback answers 302 for both a good and a bad credential, so the
 * session is what tells the two apart.
 *
 * k6 empties the cookie jar between iterations, so a script that needs a
 * session has to sign in during the iteration that uses it.
 */
export function login(email, password) {
  const csrfRes = http.get(`${BASE_URL}/api/auth/csrf`, { tags: { endpoint: 'auth' } })

  let csrfToken = ''
  try {
    csrfToken = JSON.parse(csrfRes.body)?.csrfToken || ''
  } catch {
    csrfToken = ''
  }

  const loginRes = http.post(
    `${BASE_URL}/api/auth/callback/credentials`,
    { csrfToken, email, password, callbackUrl: '/chat' },
    { json: true, redirects: 0, tags: { endpoint: 'auth' } },
  )

  const sessionRes = http.get(`${BASE_URL}/api/auth/session`, { tags: { endpoint: 'auth' } })

  return { csrfRes, loginRes, sessionRes }
}

/**
 * Signs the VU out again. k6 empties the cookie jar between iterations, so
 * this is here to put the signout endpoint under load rather than to clean
 * up after the login.
 */
export function logout() {
  const csrfRes = http.get(`${BASE_URL}/api/auth/csrf`, { tags: { endpoint: 'auth' } })

  let csrfToken = ''
  try {
    csrfToken = JSON.parse(csrfRes.body)?.csrfToken || ''
  } catch {
    csrfToken = ''
  }

  const res = http.post(
    `${BASE_URL}/api/auth/signout`,
    { csrfToken, callbackUrl: '/' },
    { json: true, redirects: 0, tags: { endpoint: 'auth' } },
  )

  return { csrfRes, res }
}
