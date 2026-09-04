import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Logger } from "@shared/logging/Logger";

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

    const url = endpoint.endsWith("/v1/traces") ? endpoint : `${endpoint.replace(/\/$/, "")}/v1/traces`;

    // Sampling env is read by SDK auto-configuration; explicit sampler via env vars
    // OTEL_TRACES_SAMPLER=parentbased_always_on | parentbased_traceidratio
    // OTEL_TRACES_SAMPLER_ARG=0.1
    // NodeSDK will pick up OTEL_* from env automatically; we just ensure exporter url is set
    const traceExporter = new OTLPTraceExporter({ url });

    const sdk = new NodeSDK({
        serviceName,
        traceExporter,
        instrumentations: [getNodeAutoInstrumentations({
            // Disable noisy / PII-prone instrumentations
            '@opentelemetry/instrumentation-fs': { enabled: false },
            '@opentelemetry/instrumentation-dns': { enabled: false },
            '@opentelemetry/instrumentation-net': { enabled: false },
        } as any)],
    });

    try {
        sdk.start();
        Logger.info(`OTEL tracing initialized for ${serviceName} -> ${url}`);
    } catch (error) {
        Logger.error(`Failed to start OTEL tracing for ${serviceName}`, error);
    }

    const shutdown = async () => {
        try {
            await sdk.shutdown();
            Logger.info(`OTEL tracing shutdown for ${serviceName}`);
        } catch {}
    };
    process.once("SIGTERM", () => void shutdown());
    process.once("SIGINT", () => void shutdown());
}
