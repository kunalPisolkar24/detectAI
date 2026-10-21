import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Logger } from "@shared/logging/Logger";
import { setLogSink } from "@shared/logging/sink";

const SEVERITIES = {
    info: SeverityNumber.INFO,
    warn: SeverityNumber.WARN,
    error: SeverityNumber.ERROR,
} as const;

let started = false;

export function initTracing(serviceNameFallback: string): void {
    if (started) return;
    started = true;

    const serviceName = process.env.OTEL_SERVICE_NAME || serviceNameFallback;
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "";
    // Fail-open: if no endpoint, tracing is disabled (local dev without collector)
    if (!endpoint) {
        Logger.info(`OTEL tracing disabled for ${serviceName} (OTEL_EXPORTER_OTLP_ENDPOINT not set)`);
        return;
    }

    const base = endpoint.replace(/\/$/, "");
    const url = endpoint.endsWith("/v1/traces") ? endpoint : `${base}/v1/traces`;
    const logsUrl = endpoint.endsWith("/v1/logs") ? endpoint : `${base}/v1/logs`;

    // Sampling env is read by SDK auto-configuration; explicit sampler via env vars
    // OTEL_TRACES_SAMPLER=parentbased_always_on | parentbased_traceidratio
    // OTEL_TRACES_SAMPLER_ARG=0.1
    // NodeSDK will pick up OTEL_* from env automatically; we just ensure exporter url is set
    const traceExporter = new OTLPTraceExporter({ url });

    const sdk = new NodeSDK({
        serviceName,
        traceExporter,
        logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter({ url: logsUrl }))],
        instrumentations: [getNodeAutoInstrumentations({
            // Disable noisy / PII-prone instrumentations
            '@opentelemetry/instrumentation-fs': { enabled: false },
            '@opentelemetry/instrumentation-dns': { enabled: false },
            '@opentelemetry/instrumentation-net': { enabled: false },
        } as any)],
    });

    try {
        sdk.start();
        // sdk.start() installs the global LoggerProvider, so the logger must be
        // resolved after it returns.
        const otelLogger = logs.getLogger(serviceName);
        setLogSink((level, message, attributes) => {
            otelLogger.emit({
                severityNumber: SEVERITIES[level],
                severityText: level,
                body: message,
                attributes,
            });
        });
        Logger.info(`OTEL tracing initialized for ${serviceName} -> ${url}`);
    } catch (error) {
        setLogSink(null);
        Logger.error(`Failed to start OTEL tracing for ${serviceName}`, error);
    }

    const shutdown = async () => {
        try {
            setLogSink(null);
            await sdk.shutdown();
            Logger.info(`OTEL tracing shutdown for ${serviceName}`);
        } catch {}
    };
    process.once("SIGTERM", () => void shutdown());
    process.once("SIGINT", () => void shutdown());
}
