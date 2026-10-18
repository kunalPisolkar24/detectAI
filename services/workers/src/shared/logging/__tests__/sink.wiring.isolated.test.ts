import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  LoggerProvider,
  BatchLogRecordProcessor,
  InMemoryLogRecordExporter,
  type ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { logs } from "@opentelemetry/api-logs";
import { Logger } from "../../logging/Logger";
import { setLogSink } from "../../logging/sink";

// Exercises the real export path end to end: Logger -> sink -> LoggerProvider
// -> processor -> exporter, mirroring the provider wiring that
// shared/tracing/instrumentation builds when OTEL_EXPORTER_OTLP_ENDPOINT is set,
// with the network exporter swapped for an in-memory one.
//
// Runs in the isolated glob because bun's mock.module is process-wide: the other
// suites replace @shared/logging/Logger wholesale, which would leave the real
// Logger (and therefore this wiring) unreachable.

// The global logger provider registers once per process, so build it once and
// swap the destination exporter between tests instead of re-registering.
let current: InMemoryLogRecordExporter = new InMemoryLogRecordExporter();

const provider = new LoggerProvider({});
provider.addLogRecordProcessor(
  new BatchLogRecordProcessor({
    export(records: ReadableLogRecord[], done: (result: { code: number }) => void) {
      current.export(records, done);
    },
    shutdown: () => Promise.resolve(),
  }),
);
logs.setGlobalLoggerProvider(provider);

const otelLogger = logs.getLogger("worker-analytics");

beforeEach(() => {
  current = new InMemoryLogRecordExporter();
  setLogSink((level, message, attributes) => {
    otelLogger.emit({
      severityNumber: level === "error" ? 17 : level === "warn" ? 13 : 9,
      severityText: level,
      body: message,
      attributes,
    });
  });
});

afterEach(() => {
  setLogSink(null);
});

const emitAndRead = async (): Promise<any[]> => {
  await provider.forceFlush();
  return current.getFinishedLogRecords() as any[];
};

describe("OTLP log wiring", () => {
  test("exports a record carrying level, message and attributes", async () => {
    Logger.info("processed", { queue: "analytics.usage", count: 3 });
    const records = await emitAndRead();

    const record = records[records.length - 1];
    expect(record).toBeDefined();
    expect(record.severityNumber).toBe(9);
    expect(record.severityText).toBe("info");
    expect(record.body).toBe("processed");
    expect(record.attributes.queue).toBe("analytics.usage");
    expect(record.attributes.count).toBe(3);
  });

  test("maps warn and error to their OpenTelemetry severity numbers", async () => {
    Logger.warn("retrying", { attempt: 2 });
    Logger.error("handler failed", new Error("boom"), { eventType: "subscription.canceled" });
    const records = await emitAndRead();

    const warn = records.find((r) => r.body === "retrying");
    const error = records.find((r) => r.body === "handler failed");
    expect(warn?.severityNumber).toBe(13);
    expect(warn?.attributes.attempt).toBe(2);
    expect(error?.severityNumber).toBe(17);
    expect(error?.attributes.error).toBe("boom");
    expect(error?.attributes.eventType).toBe("subscription.canceled");
  });

  test("drops structured context from exported attributes", async () => {
    Logger.info("payload", { nested: { a: 1 }, list: [1, 2], ok: "yes" });
    const records = await emitAndRead();

    const record = records[records.length - 1];
    expect(record.attributes.nested).toBeUndefined();
    expect(record.attributes.list).toBeUndefined();
    expect(record.attributes.ok).toBe("yes");
  });

  test("still writes to the console when no sink is registered", () => {
    setLogSink(null);
    let written = "";
    const original = console.log;
    console.log = (value?: any) => {
      written = String(value);
    };
    try {
      Logger.info("console only", { queue: "analytics.usage" });
    } finally {
      console.log = original;
    }
    expect(JSON.parse(written).message).toBe("console only");
  });
});