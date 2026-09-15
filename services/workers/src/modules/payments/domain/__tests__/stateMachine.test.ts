import { describe, test, expect } from "bun:test";
import { validateTransition } from "../stateMachine";
import { SubscriptionStatus } from "../../../../../generated/prisma/client";

describe("validateTransition", () => {
  describe("from null (new subscription)", () => {
    test("allows TRIALING", () => {
      expect(() => validateTransition(null, SubscriptionStatus.TRIALING)).not.toThrow();
    });

    test("allows ACTIVE", () => {
      expect(() => validateTransition(null, SubscriptionStatus.ACTIVE)).not.toThrow();
    });

    test("rejects CANCELED", () => {
      expect(() => validateTransition(null, SubscriptionStatus.CANCELED)).toThrow();
    });

    test("rejects PAST_DUE", () => {
      expect(() => validateTransition(null, SubscriptionStatus.PAST_DUE)).toThrow();
    });

    test("rejects PAUSED", () => {
      expect(() => validateTransition(null, SubscriptionStatus.PAUSED)).toThrow();
    });
  });

  describe("from TRIALING", () => {
    test("allows ACTIVE", () => {
      expect(() => validateTransition(SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE)).not.toThrow();
    });

    test("allows CANCELED", () => {
      expect(() => validateTransition(SubscriptionStatus.TRIALING, SubscriptionStatus.CANCELED)).not.toThrow();
    });

    test("allows PAST_DUE", () => {
      expect(() => validateTransition(SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE)).not.toThrow();
    });

    test("rejects PAUSED", () => {
      expect(() => validateTransition(SubscriptionStatus.TRIALING, SubscriptionStatus.PAUSED)).toThrow();
    });

    test("allows TRIALING (idempotent self-transition)", () => {
      expect(() => validateTransition(SubscriptionStatus.TRIALING, SubscriptionStatus.TRIALING)).not.toThrow();
    });
  });

  describe("from ACTIVE", () => {
    test("allows ACTIVE", () => {
      expect(() => validateTransition(SubscriptionStatus.ACTIVE, SubscriptionStatus.ACTIVE)).not.toThrow();
    });

    test("allows CANCELED", () => {
      expect(() => validateTransition(SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELED)).not.toThrow();
    });

    test("allows PAST_DUE", () => {
      expect(() => validateTransition(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE)).not.toThrow();
    });

    test("allows PAUSED", () => {
      expect(() => validateTransition(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED)).not.toThrow();
    });

    test("rejects TRIALING", () => {
      expect(() => validateTransition(SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING)).toThrow();
    });
  });

  describe("from PAUSED", () => {
    test("allows ACTIVE", () => {
      expect(() => validateTransition(SubscriptionStatus.PAUSED, SubscriptionStatus.ACTIVE)).not.toThrow();
    });

    test("allows CANCELED (expiry sweep)", () => {
      expect(() => validateTransition(SubscriptionStatus.PAUSED, SubscriptionStatus.CANCELED)).not.toThrow();
    });

    test("allows PAUSED (idempotent self-transition)", () => {
      expect(() => validateTransition(SubscriptionStatus.PAUSED, SubscriptionStatus.PAUSED)).not.toThrow();
    });

    test("rejects TRIALING", () => {
      expect(() => validateTransition(SubscriptionStatus.PAUSED, SubscriptionStatus.TRIALING)).toThrow();
    });
  });

  describe("from PAST_DUE", () => {
    test("allows ACTIVE", () => {
      expect(() => validateTransition(SubscriptionStatus.PAST_DUE, SubscriptionStatus.ACTIVE)).not.toThrow();
    });

    test("allows CANCELED", () => {
      expect(() => validateTransition(SubscriptionStatus.PAST_DUE, SubscriptionStatus.CANCELED)).not.toThrow();
    });

    test("allows PAST_DUE (idempotent self-transition)", () => {
      expect(() => validateTransition(SubscriptionStatus.PAST_DUE, SubscriptionStatus.PAST_DUE)).not.toThrow();
    });

    test("rejects TRIALING", () => {
      expect(() => validateTransition(SubscriptionStatus.PAST_DUE, SubscriptionStatus.TRIALING)).toThrow();
    });

    test("rejects PAUSED", () => {
      expect(() => validateTransition(SubscriptionStatus.PAST_DUE, SubscriptionStatus.PAUSED)).toThrow();
    });
  });

  describe("from CANCELED", () => {
    test("allows ACTIVE", () => {
      expect(() => validateTransition(SubscriptionStatus.CANCELED, SubscriptionStatus.ACTIVE)).not.toThrow();
    });

    test("allows TRIALING", () => {
      expect(() => validateTransition(SubscriptionStatus.CANCELED, SubscriptionStatus.TRIALING)).not.toThrow();
    });

    test("allows CANCELED (idempotent self-transition)", () => {
      expect(() => validateTransition(SubscriptionStatus.CANCELED, SubscriptionStatus.CANCELED)).not.toThrow();
    });

    test("rejects PAST_DUE", () => {
      expect(() => validateTransition(SubscriptionStatus.CANCELED, SubscriptionStatus.PAST_DUE)).toThrow();
    });

    test("rejects PAUSED", () => {
      expect(() => validateTransition(SubscriptionStatus.CANCELED, SubscriptionStatus.PAUSED)).toThrow();
    });
  });

  test("throws descriptive error message", () => {
    expect(() => validateTransition(SubscriptionStatus.TRIALING, SubscriptionStatus.PAUSED)).toThrow(
      "Invalid subscription status transition: TRIALING -> PAUSED"
    );
  });
});
