import { describe, it, expect } from "vitest";
import {
  shouldRepair,
  pruneHistory,
  isCapped,
  recoveryDue,
  MAX_ATTEMPTS,
  WINDOW_MS,
  BACKOFF_MS,
  RECOVERY_COOLDOWN_MS,
  type RepairAttempt,
} from "../src/repair-policy.js";

const T = 1_800_000_000_000;
const at = (ms: number): RepairAttempt => ({ at: ms, ok: false });

describe("repair policy", () => {
  it("allows a first repair immediately", () => {
    expect(shouldRepair([], T)).toEqual({ allow: true, remaining: MAX_ATTEMPTS });
  });

  it("holds off during backoff, then allows", () => {
    const h = [at(T)];
    expect(shouldRepair(h, T + BACKOFF_MS[0] - 1)).toMatchObject({ allow: false, reason: "backoff" });
    expect(shouldRepair(h, T + BACKOFF_MS[0] + 1)).toMatchObject({ allow: true });
  });

  it("backs off progressively, not at a fixed rate", () => {
    const two = [at(T), at(T + BACKOFF_MS[0])];
    const last = T + BACKOFF_MS[0];
    // second gap must be longer than the first
    expect(shouldRepair(two, last + BACKOFF_MS[0] + 1)).toMatchObject({ allow: false });
    expect(shouldRepair(two, last + BACKOFF_MS[1] + 1)).toMatchObject({ allow: true });
  });

  it("STOPS at the cap — the whole point (never an infinite respawn loop)", () => {
    const h = [at(T), at(T + 10_000), at(T + 20_000)];
    expect(h).toHaveLength(MAX_ATTEMPTS);
    const d = shouldRepair(h, T + 10 * 60_000);
    expect(d).toEqual({ allow: false, reason: "capped", remaining: 0 });
    expect(isCapped(h, T + 10 * 60_000)).toBe(true);
    // …and stays stopped for the rest of the window
    expect(shouldRepair(h, T + WINDOW_MS - 1).reason).toBe("capped");
  });

  it("forgives once the window rolls past — a pod that hiccups hourly is still repaired", () => {
    const h = [at(T), at(T + 10_000), at(T + 20_000)];
    const later = T + WINDOW_MS + 1;
    expect(shouldRepair(h, later)).toMatchObject({ allow: true });
    expect(isCapped(h, later)).toBe(false);
  });

  it("prunes aged-out attempts so history can't grow unbounded", () => {
    const h = [at(T - WINDOW_MS - 1), at(T - 1_000), at(T)];
    expect(pruneHistory(h, T)).toHaveLength(2);
  });

  it("is order-independent (history may be appended either way)", () => {
    const asc = [at(T), at(T + 10_000), at(T + 20_000)];
    const desc = [...asc].reverse();
    const now = T + 60_000;
    expect(shouldRepair(desc, now)).toEqual(shouldRepair(asc, now));
  });
});

describe("recoveryDue — opt-in self-heal after the cap", () => {
  const capped = [at(T), at(T + 10_000), at(T + 20_000)]; // 3 in-window failures = capped
  const lastAt = T + 20_000;

  it("is false while NOT capped (nothing to recover from)", () => {
    expect(recoveryDue([at(T)], T + 60_000)).toBe(false);
    expect(recoveryDue([], T)).toBe(false);
  });

  it("stays false right after the cap, then becomes due once the cooldown elapses", () => {
    expect(isCapped(capped, lastAt + 1)).toBe(true);
    expect(recoveryDue(capped, lastAt + RECOVERY_COOLDOWN_MS - 1)).toBe(false); // still cooling
    expect(recoveryDue(capped, lastAt + RECOVERY_COOLDOWN_MS + 1)).toBe(true); // one careful retry due
  });

  it("shouldRepair itself is UNCHANGED by recovery — it stays a hard stop at the cap (agent watchdog safety)", () => {
    // The cap must remain absolute for shouldRepair's callers; recovery is a separate, opt-in path.
    expect(shouldRepair(capped, lastAt + RECOVERY_COOLDOWN_MS + 1)).toMatchObject({ allow: false, reason: "capped" });
  });
});
