export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogAttributes = Record<string, unknown>;

export type LogSink = (level: LogLevel, message: string, attributes: LogAttributes) => void;

let sink: LogSink | null = null;

// Kept separate from the pino logger so the sink contract has a stable home:
// the tracing module installs the real exporter, and tests can swap it out
// without pulling the OpenTelemetry SDK in.
export function setLogSink(next: LogSink | null): void {
  sink = next;
}

export function emitLog(level: LogLevel, message: string, attributes: LogAttributes): void {
  if (!sink) return;
  try {
    sink(level, message, attributes);
  } catch {
    // A failing exporter must never take a request down.
  }
}
