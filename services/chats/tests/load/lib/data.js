const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomString(length) {
  let out = "";
  while (out.length < length) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

// One namespace per run: a repeated run never reads another run's rows.
export function runSuffix() {
  return `${Date.now().toString(36)}${randomString(6)}`;
}

// The owner id rides the x-user-id header and owns every chat of a run.
// The create and write burst budgets are counted per owner, so a spread of
// owners is what keeps the load run off the limiter.
export function ownerId(namespace, index = 0) {
  return `${namespace}_${String(index).padStart(6, "0")}`;
}

export function chatTitle() {
  return `Load chat ${randomString(8)}`;
}

// A message body of roughly the requested size; the length knob moves the
// write path's payload without changing its shape.
export function messageContent(bytes) {
  const filler = "load message payload ";
  const body = filler.repeat(Math.ceil(bytes / filler.length)).slice(0, bytes);
  return `${body}${randomString(8)}`;
}

// One character past the service's content bound: the guard answers 400.
export function oversizedContent() {
  return "x".repeat(100001);
}

// Weighted pick over [weight, value] pairs; the shares are normalized by the
// caller before they get here.
export function pickWeighted(pairs) {
  const roll = Math.random();
  let cumulative = 0;
  for (const [weight, value] of pairs) {
    cumulative += weight;
    if (roll < cumulative) {
      return value;
    }
  }
  return pairs[pairs.length - 1][1];
}
