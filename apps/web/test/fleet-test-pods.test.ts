import { describe, expect, it } from "vitest";
import { isTestPod } from "@/lib/fleet";

/**
 * Designated test pods are long-lived, signed-in pods used to exercise running-pod behaviour.
 * Counted in the fleet rollups they would inflate owner spend forever and permanently occupy the
 * stale/version lists — the way a drift signal becomes one nobody reads.
 */
describe("designated test pods", () => {
  it("recognises the `test:` name marker, case- and whitespace-insensitively", () => {
    expect(isTestPod({ name: "test:messaging-a" })).toBe(true);
    expect(isTestPod({ name: "TEST:codex" })).toBe(true);
    expect(isTestPod({ name: "  test:relay  " })).toBe(true);
  });

  it("does NOT capture ordinary pods that merely mention testing", () => {
    // The marker is a prefix with a colon precisely so a real project called "testing the
    // waters" is never silently dropped out of the cost the owner is asked to explain.
    expect(isTestPod({ name: "testing the waters" })).toBe(false);
    expect(isTestPod({ name: "my test pod" })).toBe(false);
    expect(isTestPod({ name: "contest:results" })).toBe(false);
    expect(isTestPod({ name: null })).toBe(false);
    expect(isTestPod({ name: "" })).toBe(false);
  });
});
