import { check } from 'k6'

// The analyze route answers with NDJSON: one JSON object per line. A stream
// that is truncated, empty, or ends in a terminal error still carries the
// right Content-Type, so the body is what proves the stream completed.

export function parseNdjson(body) {
  const events = []
  const malformed = []

  if (!body) {
    return { events, malformed: ['empty body'] }
  }

  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      events.push(JSON.parse(trimmed))
    } catch {
      malformed.push(trimmed.slice(0, 120))
    }
  }

  return { events, malformed }
}

export function expectCompleteStream(res, label) {
  const subject = parseNdjson(res.body)

  return check(subject, {
    [`${label} every line is valid json`]: (s) => s.malformed.length === 0,
    [`${label} opens with an accepted event`]: (s) => s.events.some((e) => e.type === 'accepted'),
    [`${label} ends with a final event`]: (s) => s.events.some((e) => e.type === 'final'),
    [`${label} carries no error event`]: (s) => !s.events.some((e) => e.type === 'error'),
  })
}
