package adapters

// Logs: one LoggerProvider behind the process-wide slog bridge set at boot —
// every slog line flows to OTLP and stdout both, document-parser's
// root-logger handler with slog.SetDefault as its Go face. Skeleton: lands
// with the OTel SDK wiring.
