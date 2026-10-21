import { trace as otelTrace } from "@opentelemetry/api";
import { emitLog, type LogLevel } from "@shared/logging/sink";
import { isSensitiveKey, redact, toLogAttributes } from "@shared/logging/redact";

function safeStringify(obj: Record<string, unknown>): string {
    const seen = new WeakSet();
    try {
        return JSON.stringify(obj, (key, value) => {
            if (isSensitiveKey(key)) {
                return redact(key, value);
            }
            if (typeof value === "object" && value !== null) {
                if (seen.has(value as object)) return "[Circular]";
                seen.add(value as object);
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

function forward(level: LogLevel, payload: Record<string, unknown>): void {
    emitLog(level, payload.message as string, toLogAttributes(payload));
}

export class Logger {
    static info(message: string, context?: Record<string, any>) {
        const enriched = withTraceContext(context);
        const payload = { level: 'info', message, ...enriched, timestamp: new Date().toISOString() };
        console.log(safeStringify(payload));
        forward('info', payload);
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
        forward('error', payload);
    }

    static warn(message: string, context?: Record<string, any>) {
        const enriched = withTraceContext(context);
        const payload = { level: 'warn', message, ...enriched, timestamp: new Date().toISOString() };
        console.warn(safeStringify(payload));
        forward('warn', payload);
    }
}