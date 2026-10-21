export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogAttributes = Record<string, unknown>;

export type LogSink = (level: LogLevel, message: string, attributes: LogAttributes) => void;

// The sink lives on globalThis, not in a module variable: Next.js compiles the
// instrumentation, the app and the middleware as separate layers, each with its
// own copy of this module. A module-level variable would be set in the
// instrumentation layer and invisible to the layers that log.
const SINK_KEY = Symbol.for("detectai.web.logSink");

type GlobalWithSink = typeof globalThis & { [SINK_KEY]?: LogSink | null };

// Kept separate from the pino logger so the sink contract has a stable home:
// the tracing module installs the real exporter, and tests can swap it out
// without pulling the OpenTelemetry SDK in.
export function setLogSink(next: LogSink | null): void {
  (globalThis as GlobalWithSink)[SINK_KEY] = next;
}

export function emitLog(level: LogLevel, message: string, attributes: LogAttributes): void {
  const sink = (globalThis as GlobalWithSink)[SINK_KEY];
  if (!sink) return;
  try {
    sink(level, message, attributes);
  } catch {
    // A failing exporter must never take a request down.
  }
}
