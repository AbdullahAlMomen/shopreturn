import { describe, expect, it } from "vitest";
import { buildNotifyRequest, notifyFailed } from "./notifyRequest";

describe("buildNotifyRequest", () => {
  it("fills the five fields the notifier requires, verbatim", () => {
    expect(buildNotifyRequest("ops", "RETURN_SUBMITTED", { returnId: "r1", orderNumber: "10-4825" })).toEqual({
      configurationName: "shopreturn",
      connectionId: "",
      responseKey: "shopreturn",
      responseValue: "RETURN_SUBMITTED",
      roles: ["ops"],
      denormalizedPayload: JSON.stringify({ kind: "RETURN_SUBMITTED", returnId: "r1", orderNumber: "10-4825" }),
      saveDenormalizedPayloadAsAnObject: true
    });
  });
});

describe("notifyFailed", () => {
  it("accepts the live success shape", () => {
    expect(notifyFailed({ errors: null, isSuccess: true })).toBe(false);
  });

  it("fails on isSuccess false", () => {
    expect(notifyFailed({ isSuccess: false })).toBe(true);
  });

  it("fails on an errors object with keys (the missing-configuration shape)", () => {
    expect(notifyFailed({ errors: { ConfigurationName: "no_configuration_exist" }, isSuccess: false })).toBe(true);
    expect(notifyFailed({ errors: { ConfigurationName: "no_configuration_exist" } })).toBe(true);
  });

  it("fails on a non-empty errors array", () => {
    expect(notifyFailed({ errors: [{ message: "boom" }] })).toBe(true);
  });

  it("fails when there is no response at all", () => {
    expect(notifyFailed(undefined)).toBe(true);
  });
});
