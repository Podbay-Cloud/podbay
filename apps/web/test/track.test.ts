import { describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn(() => { throw new Error("posthog not initialised"); }) },
}));

const { track } = await import("@/lib/track");

/**
 * Every client capture in this app sits immediately BEFORE the real work — sign-in, launch,
 * suspend, delete. An unguarded throw there does not lose a metric, it loses the user's
 * action, and the UI just looks like it ignored the click.
 */
describe("track()", () => {
  it("swallows a throwing analytics client so the caller's next line still runs", () => {
    let actionRan = false;
    expect(() => {
      track("pod_suspended", { pod_id: "x" });
      actionRan = true;
    }).not.toThrow();
    expect(actionRan).toBe(true);
  });
});
