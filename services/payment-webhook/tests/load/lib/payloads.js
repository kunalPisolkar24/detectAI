import exec from "k6/execution";
import crypto from "k6/crypto";

// Wire-size targets per profile; near-limit/oversize size against the boot's read bound
// (min over MAX_BODY_BYTES and SQS's 256 KiB ceiling) so edges hold under every boot.
const PROFILE_BYTES = {
  small: 200,
  mid: 4096,
  large: 65536,
  "near-limit": 256000,
  oversize: 290 * 1024,
};

// The signature header mirrors Paddle's own: HMAC over "<ts>:<raw body>".
export function sign(secret, body, ts = Math.floor(Date.now() / 1000)) {
  const h1 = crypto.hmac("sha256", secret, `${ts}:${body}`, "hex");
  return `ts=${ts};h1=${h1}`;
}

export function pickProfile(config, iteration = exec.scenario.iterationInTest) {
  return config.profiles[iteration % config.profiles.length];
}

function poolEntry(index) {
  return String(index).padStart(4, "0");
}

// Subscription, customer, and user shift together so FIFO groups spread across the pool.
function envelopeShaping(config, seed) {
  const slot = seed % config.pool;
  const entry = poolEntry(slot);
  return {
    dataId: `sub_${entry}`,
    customerId: `ctm_${entry}`,
    transactionId: `txn_${entry}_a1f`,
    userId: `user-${entry}`,
  };
}

function paddedEnvelope(target, envelope) {
  const base = JSON.stringify(envelope);
  if (base.length >= target) {
    return base;
  }
  envelope.pad = "x".repeat(target - base.length - `,"pad":""`.length);
  return JSON.stringify(envelope);
}

// One signed request for one profile; the caller owns the event id and seed.
export function buildSignedRequest(config, { profile, eventId, eventType, seed = 0 }) {
  const target = PROFILE_BYTES[profile];
  if (target === undefined) {
    throw new Error(`Unknown webhook profile: ${profile} (known: ${Object.keys(PROFILE_BYTES).join(", ")})`);
  }
  const shaping = envelopeShaping(config, seed);
  const body = paddedEnvelope(target, {
    event_id: eventId,
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    notification_id: `ntf_${eventId}`,
    data: {
      id: shaping.dataId,
      status: "active",
      customer_id: shaping.customerId,
      transaction_id: shaping.transactionId,
      custom_data: { user_id: shaping.userId },
    },
  });
  return {
    profile,
    eventType,
    body,
    signature: sign(config.webhookSecret, body),
  };
}

// The advisory row: complete on every hard gate, nothing addressable in data.
export function buildAdvisoryRequest(config, { eventId, eventType }) {
  const body = JSON.stringify({
    event_id: eventId,
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    notification_id: `ntf_${eventId}`,
    data: {},
  });
  return {
    profile: "advisory",
    eventType,
    body,
    signature: sign(config.webhookSecret, body),
  };
}

// A small valid body reshaped per case so the route's guard answers, not a broken payload.
function smallVariant(config, eventId, reshape) {
  const shaping = envelopeShaping(config, 0);
  const envelope = {
    event_id: eventId,
    event_type: config.eventTypes[0],
    occurred_at: new Date().toISOString(),
    notification_id: `ntf_${eventId}`,
    data: {
      id: shaping.dataId,
      status: "active",
      customer_id: shaping.customerId,
      transaction_id: shaping.transactionId,
      custom_data: { user_id: shaping.userId },
    },
  };
  reshape(envelope);
  return envelope;
}

// The rejection matrix, one case per guard (401 signature, 413 bounded read, 422 envelope);
// signature rows carry otherwise-valid bodies so the guard, not a broken payload, rejects.
export function negativePayloads(config) {
  const enrich = (eventId) => smallVariant(config, eventId, () => {});
  const unsigned = enrich("evt_smoke_unsigned");
  const stale = enrich("evt_smoke_stale");
  const wrongSecret = enrich("evt_smoke_wrong_secret");
  const malformedHeader = enrich("evt_smoke_malformed_header");
  const missingId = smallVariant(config, "evt_smoke_missing_id", (envelope) => delete envelope.event_id);
  const nullData = smallVariant(config, "evt_smoke_null_data", (envelope) => { envelope.data = null; });
  const badOccurrence = smallVariant(config, "evt_smoke_bad_occurrence", (envelope) => {
    envelope.occurred_at = "yesterday";
  });

  const unsignedBody = JSON.stringify(unsigned);
  const staleBody = JSON.stringify(stale);
  const wrongSecretBody = JSON.stringify(wrongSecret);
  const missingIdBody = JSON.stringify(missingId);
  const nullDataBody = JSON.stringify(nullData);
  const badOccurrenceBody = JSON.stringify(badOccurrence);
  const oversizeBody = paddedEnvelope(PROFILE_BYTES.oversize, {
    event_id: "evt_smoke_oversize",
    event_type: config.eventTypes[0],
    occurred_at: new Date().toISOString(),
    notification_id: "ntf_smoke_oversize",
    data: {
      id: envelopeShaping(config, 0).dataId,
      status: "active",
      customer_id: envelopeShaping(config, 0).customerId,
      transaction_id: envelopeShaping(config, 0).transactionId,
      custom_data: { user_id: envelopeShaping(config, 0).userId },
    },
  });
  const plainBody = "not-json";

  return [
    { case: "missing-signature", expected: 401, body: unsignedBody },
    { case: "stale-signature", expected: 401, body: staleBody, signature: sign(config.webhookSecret, staleBody, Math.floor(Date.now() / 1000) - 301) },
    { case: "wrong-secret-signature", expected: 401, body: wrongSecretBody, signature: sign("load-test-wrong-secret", wrongSecretBody) },
    { case: "malformed-signature", expected: 401, body: JSON.stringify(malformedHeader), signature: "ts=oops;h1=zz" },
    { case: "oversize-body", expected: 413, body: oversizeBody, signature: sign(config.webhookSecret, oversizeBody) },
    { case: "missing-event-id", expected: 422, body: missingIdBody, signature: sign(config.webhookSecret, missingIdBody) },
    { case: "null-data", expected: 422, body: nullDataBody, signature: sign(config.webhookSecret, nullDataBody) },
    { case: "bad-occurred-at", expected: 422, body: badOccurrenceBody, signature: sign(config.webhookSecret, badOccurrenceBody) },
    { case: "non-object-body", expected: 422, body: plainBody, signature: sign(config.webhookSecret, plainBody) },
  ];
}
