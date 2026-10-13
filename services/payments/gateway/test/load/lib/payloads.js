import { generatePaddleSignature } from '../utils.js';

// Deterministic traffic mix for gateway load tests. Profiles are picked
// round-robin by iteration index so every run covers the full mix
// reproducibly (same approach as the document-parser fixtures).
// Sizes: small ~200B, medium ~4K, large ~100K, near-limit ~900K
// (gateway hard limit is 1MiB in readBody).
const PROFILES = [
    { name: 'webhook-small', kind: 'webhook', eventType: 'subscription.updated', size: 200 },
    { name: 'webhook-medium', kind: 'webhook', eventType: 'subscription.created', size: 4096 },
    { name: 'webhook-large', kind: 'webhook', eventType: 'subscription.updated', size: 102400 },
    { name: 'webhook-near-limit', kind: 'webhook', eventType: 'subscription.created', size: 921600 },
    { name: 'internal-small', kind: 'internal', eventType: 'user.cancel_subscription', size: 200 },
    { name: 'internal-medium', kind: 'internal', eventType: 'user.updated', size: 4096 },
];

export function listProfiles() {
    return PROFILES.map((p) => p.name);
}

export function pickProfile(iteration) {
    return PROFILES[iteration % PROFILES.length];
}

function padPayload(obj, size) {
    const base = JSON.stringify(obj);
    if (base.length >= size) {
        return base;
    }
    obj.pad = 'x'.repeat(size - base.length - 12);
    return JSON.stringify(obj);
}

export function buildRequest(profile, secrets) {
    if (profile.kind === 'internal') {
        const payload = padPayload({ event_type: profile.eventType, data: { userId: 'user-123' } }, profile.size);
        return {
            method: 'POST',
            url: '/internal/events',
            body: payload,
            params: {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-Key': secrets.internalKey,
                },
            },
            expect: 200,
        };
    }
    const payload = padPayload(
        { event_id: `evt_${profile.name}`, event_type: profile.eventType, data: { id: 'sub_123', status: 'active' } },
        profile.size
    );
    return {
        method: 'POST',
        url: '/webhook/paddle',
        body: payload,
        params: {
            headers: {
                'Content-Type': 'application/json',
                'Paddle-Signature': generatePaddleSignature(payload, secrets.webhookSecret),
            },
        },
        expect: 200,
    };
}

// Small share of invalid-signature noise, like prod sees. Returns a request
// that must be rejected with 401.
export function buildInvalidSignatureRequest(secrets) {
    const payload = JSON.stringify({ event_type: 'subscription.updated', data: { id: 'sub_123' } });
    return {
        method: 'POST',
        url: '/webhook/paddle',
        body: payload,
        params: {
            headers: {
                'Content-Type': 'application/json',
                'Paddle-Signature': generatePaddleSignature(payload, 'wrong_secret_noise'),
            },
        },
        expect: 401,
    };
}

export function secretsFromEnv() {
    return {
        webhookSecret: __ENV.PADDLE_WEBHOOK_SECRET || 'test_secret',
        internalKey: __ENV.INTERNAL_API_KEY || 'test_internal_key',
        baseUrl: __ENV.BASE_URL || 'http://localhost:8080',
    };
}
