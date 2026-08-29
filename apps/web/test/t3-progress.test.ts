import { describe, it, expect } from "vitest";
import { nextT3EnableAction, type T3Progress } from "@/lib/t3-progress";

/**
 * Regression coverage for the T3 enable-progress state machine. The freeze that dogged the wizard for
 * two days (through 2026-08-25) was a single conflation here: a FINISHED enable and a NOT-YET-STARTED
 * enable both report `active:false, startedAt:null`, and the old inline code early-returned ("wait")
 * on the finished one too — so the wizard never left "Preparing" even though the pod was fully in T3
 * control. Every row below pins one edge so it can't come back.
 */
const IDLE = { t3Connected: false, connecting: false };

function prog(p: Partial<T3Progress>): T3Progress {
  return { active: false, stage: null, startedAt: null, inControl: false, ...p };
}

describe("nextT3EnableAction", () => {
  it("waits while the enable is actively provisioning (each real stage)", () => {
    for (const stage of ["preparing", "downloading", "starting"]) {
      expect(nextT3EnableAction(prog({ active: true, startedAt: "2026-08-25T00:00:00Z", stage }), IDLE)).toBe("wait");
    }
  });

  it("waits during the pre-start grace window (optimistic flip, t3Since not written yet)", () => {
    // active:false, startedAt:null, NOT in control → the server hasn't recorded the start; keep waiting.
    expect(nextT3EnableAction(prog({ active: false, startedAt: null, inControl: false, stage: null }), IDLE)).toBe(
      "wait",
    );
  });

  it("THE BUG: a completed enable (active:false, startedAt:null, inControl:true) routes to connect, not wait", () => {
    // This is the exact shape the server writes at `ready`: t3Since cleared, t3Control true, stage ready.
    const done = prog({ active: false, startedAt: null, inControl: true, stage: "ready" });
    expect(nextT3EnableAction(done, IDLE)).toBe("connect");
  });

  it("a completed enable still routes to connect even if stage was already cleared to null", () => {
    expect(nextT3EnableAction(prog({ active: false, startedAt: null, inControl: true, stage: null }), IDLE)).toBe(
      "connect",
    );
  });

  it("completed + already connected → done (close the screen, no connect wizard)", () => {
    const done = prog({ active: false, inControl: true, stage: "ready" });
    expect(nextT3EnableAction(done, { t3Connected: true, connecting: false })).toBe("done");
  });

  it("completed + mid-connect → done (don't re-open the connect wizard over itself)", () => {
    const done = prog({ active: false, inControl: true, stage: "ready" });
    expect(nextT3EnableAction(done, { t3Connected: false, connecting: true })).toBe("done");
  });

  it("error surfaces even though clearT3Failure also nulls t3Since (startedAt:null)", () => {
    // The old code checked `error` AFTER the startedAt early-return, so a failure that cleared t3Since
    // was swallowed into a hang. Order now puts error first.
    expect(nextT3EnableAction(prog({ active: false, startedAt: null, inControl: false, stage: "error" }), IDLE)).toBe(
      "error",
    );
  });

  it("error wins over inControl if both are somehow set", () => {
    expect(nextT3EnableAction(prog({ active: false, inControl: true, stage: "error" }), IDLE)).toBe("error");
  });

  it("an enable that ended without taking control does not hang (started, inactive, not in control)", () => {
    expect(
      nextT3EnableAction(prog({ active: false, startedAt: "2026-08-25T00:00:00Z", inControl: false, stage: null }), IDLE),
    ).toBe("done");
  });
});
