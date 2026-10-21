import { check } from 'k6'

// Rejections are part of the contract, not failures. k6 counts every status
// of 400 or above as a failed request, so the scripts that assert rejections
// widen the accepted set with http.setResponseCallback. Anything outside it
// - a 5xx, a timeout - still fails the request and trips the thresholds.

export function expectStatus(res, expected, label) {
  return check(res, {
    [`${label} responds ${expected}`]: (r) => r.status === expected,
  })
}

/**
 * The rejection body has to say what went wrong, not just that something did.
 */
export function expectErrorBody(res, fragment, label) {
  const checks = {
    [`${label} body carries an error`]: (r) => {
      try {
        return typeof JSON.parse(r.body)?.error === 'string'
      } catch {
        return false
      }
    },
  }

  if (fragment) {
    checks[`${label} body explains "${fragment}"`] = (r) => r.body.includes(fragment)
  }

  return check(res, checks)
}

export function expectSession(res, label) {
  return check(res, {
    [`${label} returns a session`]: (r) => {
      try {
        return typeof JSON.parse(r.body)?.user?.email === 'string'
      } catch {
        return false
      }
    },
  })
}

export function expectPremiumSession(res, label) {
  return check(res, {
    [`${label} session is premium`]: (r) => {
      try {
        return JSON.parse(r.body)?.user?.isPremium === true
      } catch {
        return false
      }
    },
  })
}

// The NextAuth callback answers with a redirect for a good and for a bad
// credential alike, so the status is only worth asserting as a redirect.
export function expectRedirect(res, label) {
  return check(res, {
    [`${label} redirects`]: (r) => r.status >= 300 && r.status < 400,
  })
}

// A rejected credential redirects to NextAuth's error page, an accepted one
// to the callback URL. The exact URL is NextAuth's business; which one it
// picked is the contract.
export function expectLoginRejected(res, label) {
  return check(res, {
    [`${label} redirects to the error page`]: (r) => String(r.headers.Location || '').includes('error'),
  })
}

export function expectLoginAccepted(res, label) {
  return check(res, {
    [`${label} is accepted`]: (r) => {
      const location = String(r.headers.Location || '')
      return location.length > 0 && !location.includes('error') && r.status < 400
    },
  })
}

export function expectNoSession(res, label) {
  return check(res, {
    [`${label} returns no session`]: (r) => {
      try {
        const body = JSON.parse(r.body)
        return !!body && Object.keys(body).length === 0
      } catch {
        return false
      }
    },
  })
}
