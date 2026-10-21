const SENSITIVE_KEYS = new Set([
    "email", "paddleCustomerId", "customer_id", "customerId", "paddleSubscriptionId",
    "apiKey", "api_key", "password", "PASSWORD", "REDIS_PASSWORD", "EVENT_REDIS_PASSWORD",
    "PADDLE_API_KEY", "Authorization", "authorization"
]);

function redactValue(key: string, value: unknown): unknown {
    if (typeof value === "string" && value.length > 0) {
        return `${value.slice(0, 3)}***`;
    }
    return "***";
}

export function isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEYS.has(key);
}

export function redact(key: string, value: unknown): unknown {
    return isSensitiveKey(key) ? redactValue(key, value) : value;
}

import type { LogAttributes } from "@opentelemetry/api-logs";

// OTLP log attributes are primitives only, so anything structured is dropped
// rather than serialised into the payload.
export function toLogAttributes(payload: Record<string, unknown>): LogAttributes {
    const attributes: LogAttributes = {};
    for (const [key, value] of Object.entries(payload)) {
        const safe = redact(key, value);
        if (safe === null || safe === undefined) continue;
        if (typeof safe === "string" || typeof safe === "number" || typeof safe === "boolean") {
            attributes[key] = safe;
        }
    }
    return attributes;
}