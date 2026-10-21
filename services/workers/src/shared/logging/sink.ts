import type { LogAttributes } from "@opentelemetry/api-logs";

export type LogLevel = "info" | "warn" | "error";

export type LogSink = (level: LogLevel, message: string, attributes: LogAttributes) => void;

let sink: LogSink | null = null;

// Kept separate from Logger so the sink contract has a stable home: unit tests
// routinely replace the Logger module wholesale, and a sink exported from there
// would disappear with it.
export function setLogSink(next: LogSink | null): void {
    sink = next;
}

export function emitLog(level: LogLevel, message: string, attributes: LogAttributes): void {
    if (!sink) return;
    try {
        sink(level, message, attributes);
    } catch {}
}