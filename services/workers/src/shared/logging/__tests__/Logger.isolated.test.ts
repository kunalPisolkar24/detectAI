import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Logger } from "../Logger";
import { setLogSink } from "../sink";

describe("Logger OTLP sink", () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  beforeEach(() => {
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
  });

  afterEach(() => {
    setLogSink(null);
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  test("does nothing on the sink when none is registered", () => {
    expect(() => Logger.info("no sink")).not.toThrow();
  });

  test("forwards level, message and context to the sink", () => {
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    setLogSink((level, message, attributes) => calls.push([level, message, attributes]));

    Logger.info("processed", { queue: "analytics.usage", count: 3 });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error("sink was not called");
    expect(call[0]).toBe("info");
    expect(call[1]).toBe("processed");
    expect(call[2]).toMatchObject({ queue: "analytics.usage", count: 3 });
  });

  test("forwards warn and error levels", () => {
    const levels: string[] = [];
    setLogSink((level) => levels.push(level));

    Logger.warn("retrying");
    Logger.error("handler failed", new Error("boom"));

    expect(levels).toEqual(["warn", "error"]);
  });

  test("redacts sensitive attributes before forwarding", () => {
    let forwarded: Record<string, unknown> = {};
    setLogSink((_level, _message, attributes) => {
      forwarded = attributes;
    });

    Logger.info("user touched", { email: "kunal@example.com", apiKey: "sk-live-secret" });

    expect(forwarded.email).toBe("kun***");
    expect(forwarded.apiKey).toBe("sk-***");
  });

  test("drops non-primitive and undefined attributes", () => {
    let forwarded: Record<string, unknown> = {};
    setLogSink((_level, _message, attributes) => {
      forwarded = attributes;
    });

    Logger.info("payload", { nested: { a: 1 }, list: [1, 2], missing: undefined, ok: "yes" });

    expect(forwarded).not.toHaveProperty("nested");
    expect(forwarded).not.toHaveProperty("list");
    expect(forwarded).not.toHaveProperty("missing");
    expect(forwarded.ok).toBe("yes");
  });

  test("a throwing sink never breaks console logging", () => {
    let written = false;
    console.log = () => {
      written = true;
    };
    setLogSink(() => {
      throw new Error("exporter down");
    });

    expect(() => Logger.info("still logs")).not.toThrow();
    expect(written).toBe(true);
  });

  test("setLogSink(null) stops forwarding", () => {
    const calls: string[] = [];
    setLogSink((_level, message) => calls.push(message));
    Logger.info("first");
    setLogSink(null);
    Logger.info("second");

    expect(calls).toEqual(["first"]);
  });
});

describe("Logger console output", () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  beforeEach(() => {
    setLogSink(null);
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  test("info writes a single JSON line with level, message and timestamp", () => {
    let line = "";
    console.log = (value?: any) => {
      line = String(value);
    };

    Logger.info("connected", { queue: "payment_events" });

    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("connected");
    expect(parsed.queue).toBe("payment_events");
    expect(typeof parsed.timestamp).toBe("string");
  });

  test("error serializes Error instances into message and stack", () => {
    let line = "";
    console.error = (value?: any) => {
      line = String(value);
    };

    Logger.error("handler failed", new Error("boom"));

    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("error");
    expect(parsed.error).toBe("boom");
    expect(parsed.stack).toContain("boom");
  });

  test("error treats a plain second argument as context", () => {
    let line = "";
    console.error = (value?: any) => {
      line = String(value);
    };

    Logger.error("handler failed", { eventType: "subscription.canceled" });

    const parsed = JSON.parse(line);
    expect(parsed.eventType).toBe("subscription.canceled");
    expect(parsed.error).toBeUndefined();
  });
});