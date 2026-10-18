import { describe, test, expect, afterEach } from "bun:test";
import { emitLog, setLogSink, type LogLevel } from "../sink";

describe("log sink", () => {
  afterEach(() => {
    setLogSink(null);
  });

  test("is a no-op until a sink is registered", () => {
    expect(() => emitLog("info", "dropped", {})).not.toThrow();
  });

  test("forwards level, message and attributes", () => {
    const seen: Array<[LogLevel, string, Record<string, unknown>]> = [];
    setLogSink((level, message, attributes) => seen.push([level, message, attributes]));

    emitLog("warn", "retrying", { attempt: 2 });

    expect(seen).toEqual([["warn", "retrying", { attempt: 2 }]]);
  });

  test("swallows sink failures so console logging is never blocked", () => {
    setLogSink(() => {
      throw new Error("exporter down");
    });

    expect(() => emitLog("error", "still emitted", {})).not.toThrow();
  });

  test("setLogSink(null) detaches the sink", () => {
    const seen: string[] = [];
    setLogSink((_level, message) => seen.push(message));
    emitLog("info", "first", {});
    setLogSink(null);
    emitLog("info", "second", {});

    expect(seen).toEqual(["first"]);
  });
});