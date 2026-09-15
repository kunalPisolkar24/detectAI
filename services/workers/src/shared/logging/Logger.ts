import { trace as otelTrace } from "@opentelemetry/api";

const SENSITIVE_KEYS = new Set([
    "email", "paddleCustomerId", "customer_id", "customerId", "paddleSubscriptionId",
    "apiKey", "api_key", "password", "PASSWORD", "REDIS_PASSWORD", "EVENT_REDIS_PASSWORD",
    "PADDLE_API_KEY", "Authorization", "authorization"
]);

function redactValue(key: string, value: unknown): unknown {
    if (SENSITIVE_KEYS.has(key)) {
        if (typeof value === "string" && value.length > 0) {
            return `${value.slice(0, 3)}***`;
        }
        return "***";
    }
    // Hash email-like values
    if (typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return `${value.slice(0, 2)}***@${value.split("@")[1]}`;
    }
    return value;
}

function safeStringify(obj: Record<string, unknown>): string {
    const seen = new WeakSet();
    try {
        return JSON.stringify(obj, (key, value) => {
            if (key && SENSITIVE_KEYS.has(key)) {
                return redactValue(key, value);
            }
            if (typeof value === "object" && value !== null) {
                if (seen.has(value as object)) return "[Circular]";
                seen.add(value as object);
            }
            // Redact email-like strings at root keys too
            if (typeof value === "string" && key === "email") {
                return redactValue(key, value) as string;
            }
            return value;
        });
    } catch {
        try {
            return JSON.stringify({ message: String(obj.message ?? ""), fallback: String(obj) });
        } catch {
            return `{"level":"error","message":"stringify_failed","timestamp":"${new Date().toISOString()}"}`;
        }
    }
}

function withTraceContext(context?: Record<string, unknown>): Record<string, unknown> {
    try {
        const span = otelTrace.getActiveSpan();
        const ctx = span?.spanContext();
        if (ctx?.traceId) {
            return { traceId: ctx.traceId, spanId: ctx.spanId, ...context };
        }
    } catch {}
    return context ?? {};
}

export class Logger {
    static info(message: string, context?: Record<string, any>) {
        const enriched = withTraceContext(context);
        console.log(safeStringify({ level: 'info', message, ...enriched, timestamp: new Date().toISOString() }));
    }

    static error(message: string, error?: any, context?: Record<string, any>) {
        const enriched = withTraceContext(context);
        // Support overloaded usage: Logger.error(msg, {context}) where second arg is context not error
        let errorObj: any = error;
        let ctx: Record<string, any> | undefined = enriched;
        if (error && typeof error === "object" && !(error instanceof Error) && !("message" in error) && enriched && Object.keys(enriched).length === 0) {
            // Heuristic: second arg was actually context
            ctx = error as Record<string, any>;
            errorObj = undefined;
        }
        const payload: Record<string, unknown> = {
            level: 'error',
            message,
            error: errorObj instanceof Error ? errorObj.message : errorObj,
            stack: errorObj instanceof Error ? errorObj.stack : undefined,
            ...ctx,
            timestamp: new Date().toISOString()
        };
        console.error(safeStringify(payload));
    }

    static warn(message: string, context?: Record<string, any>) {
        const enriched = withTraceContext(context);
        console.warn(safeStringify({ level: 'warn', message, ...enriched, timestamp: new Date().toISOString() }));
    }
}