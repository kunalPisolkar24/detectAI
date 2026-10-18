import { describe, test, expect } from "bun:test";
import { isSensitiveKey, redact, toLogAttributes } from "../redact";

describe("isSensitiveKey", () => {
  test("covers credentials and Paddle identifiers", () => {
    expect(isSensitiveKey("apiKey")).toBe(true);
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("PADDLE_API_KEY")).toBe(true);
    expect(isSensitiveKey("Authorization")).toBe(true);
    expect(isSensitiveKey("paddleSubscriptionId")).toBe(true);
  });

  test("leaves ordinary keys alone", () => {
    expect(isSensitiveKey("queue")).toBe(false);
    expect(isSensitiveKey("count")).toBe(false);
  });
});

describe("redact", () => {
  test("masks sensitive string values, keeping a short prefix", () => {
    expect(redact("apiKey", "sk-live-abc123")).toBe("sk-***");
    expect(redact("password", "hunter2")).toBe("hun***");
  });

  test("masks non-string sensitive values entirely", () => {
    expect(redact("password", 12345678)).toBe("***");
    expect(redact("apiKey", { nested: true })).toBe("***");
    expect(redact("password", "")).toBe("***");
  });

  test("passes non-sensitive values through untouched", () => {
    expect(redact("queue", "analytics.usage")).toBe("analytics.usage");
    expect(redact("count", 7)).toBe(7);
  });
});

describe("toLogAttributes", () => {
  test("keeps primitives and redacts sensitive keys", () => {
    const attributes = toLogAttributes({
      message: "processed",
      queue: "analytics.usage",
      count: 3,
      ok: true,
      email: "kunal@example.com",
    });

    expect(attributes).toEqual({
      message: "processed",
      queue: "analytics.usage",
      count: 3,
      ok: true,
      email: "kun***",
    });
  });

  test("drops null, undefined and structured values", () => {
    const attributes = toLogAttributes({
      keep: "yes",
      missing: undefined,
      empty: null,
      nested: { a: 1 },
      list: [1, 2],
    });

    expect(attributes).toEqual({ keep: "yes" });
  });

  test("preserves zero and false rather than treating them as absent", () => {
    expect(toLogAttributes({ count: 0, failed: false })).toEqual({ count: 0, failed: false });
  });
});