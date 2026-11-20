// Shared configuration for the k6 load scripts.
//
// Every knob comes from the environment so the same script runs unchanged in
// the Docker rig (infra/compose.load.yml) and on a developer machine.

// WEB_BASE_URL is the name the e2e harness uses; BASE_URL is the older name
// and still wins when both are set.
export const BASE_URL = (__ENV.WEB_BASE_URL || __ENV.BASE_URL || 'http://localhost:3001').replace(/\/+$/, '')

// The key the frontend checks the internal key against. INTERNAL_KEY is the
// older name the rig uses. A request carrying it takes the load-test path
// in the analyze route: a fixed user, premium, no abuse limiter.
export const INTERNAL_KEY = __ENV.INTERNAL_API_KEY || __ENV.INTERNAL_KEY || 'load-test-key'

// Seeded accounts (see test/load/seed/).
const LOAD_PASSWORD = __ENV.LOAD_USER_PASSWORD || 'LoadTest123!'
export const FREE_USER = {
  email: __ENV.FREE_USER_EMAIL || 'load-free@detectai.test',
  password: LOAD_PASSWORD,
}
export const PREMIUM_USER = {
  email: __ENV.PREMIUM_USER_EMAIL || 'load-premium@detectai.test',
  password: LOAD_PASSWORD,
}

const SCENARIOS = {
  smoke: { vus: 1, duration: '10s' },
  load: { vus: 10, duration: '2m' },
  stress: {
    stages: [
      { duration: '30s', target: 10 },
      { duration: '60s', target: 25 },
      { duration: '120s', target: 50 },
      { duration: '90s', target: 50 },
    ],
  },
}

/**
 * VUS and DURATION win over SCENARIO so the makefile can override a run
 * without editing the script.
 */
function loadProfile() {
  const vus = Number.parseInt(__ENV.VUS, 10)
  const duration = __ENV.DURATION
  const named = SCENARIOS[String(__ENV.SCENARIO || 'load').toLowerCase()] || SCENARIOS.load

  if (Number.isFinite(vus) && vus > 0 && duration) {
    return { vus, duration }
  }
  // An override on its own still applies: the named profile supplies the
  // half that was not given. Ignoring a lone VUS made a run look like it
  // had used the value it was given.
  if (Number.isFinite(vus) && vus > 0) {
    return { vus, duration: named.duration }
  }
  if (duration) {
    return { vus: named.vus, duration }
  }
  return named
}

/**
 * k6 accepts either { vus, duration } or { stages }, never both.
 */
export function loadOptions(defaults = {}) {
  const profile = loadProfile()
  const options = {
    gracefulStop: '30s',
    // The default trend stats stop at p(95); the run summary wants the tail.
    summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
    ...defaults,
  }

  if (profile.stages) {
    options.stages = profile.stages
  } else {
    options.vus = profile.vus
    options.duration = profile.duration
  }

  return options
}
