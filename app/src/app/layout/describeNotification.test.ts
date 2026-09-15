import { describe, expect, it } from "vitest";
import { describeNotification } from "./describeNotification";

describe("describeNotification", () => {
  it("links a submitted return to its review page", () => {
    expect(describeNotification({ denormalizedPayload: { kind: "RETURN_SUBMITTED", returnId: "r 1", orderNumber: "10-4825" } })).toEqual({
      key: "notifications.returnSubmitted",
      replacements: { orderNumber: "10-4825" },
      href: "/ops/review?id=r%201"
    });
  });

  it("links a pattern alert to Analytics", () => {
    expect(describeNotification({ denormalizedPayload: { kind: "PATTERN_ALERT", value: "Mirpur 11", metric: 31 } })).toEqual({
      key: "notifications.patternAlert",
      replacements: { value: "Mirpur 11", metric: "31" },
      href: "/insights"
    });
  });

  it("parses a payload that arrives as a JSON string", () => {
    expect(describeNotification({ denormalizedPayload: JSON.stringify({ kind: "PATTERN_ALERT", value: "SH-022", metric: 37.8 }) }).key).toBe("notifications.patternAlert");
  });

  it("renders an unknown kind generically, without a link", () => {
    expect(describeNotification({ denormalizedPayload: { kind: "SOMETHING_NEW" } })).toEqual({ key: "notifications.generic", replacements: {} });
  });

  it("survives a malformed payload", () => {
    expect(describeNotification({ denormalizedPayload: "{not json" })).toEqual({ key: "notifications.generic", replacements: {} });
  });

  it("does not link a submitted return that has no id", () => {
    expect(describeNotification({ denormalizedPayload: { kind: "RETURN_SUBMITTED", orderNumber: "10-4825" } }).key).toBe("notifications.generic");
  });
});
