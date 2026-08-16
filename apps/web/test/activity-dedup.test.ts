import { describe, it, expect } from "vitest";
import { dedupeRestartNoise, type RestartLike } from "../lib/activity-dedup";

/** Build a newest-first list like getPodActivity produces. */
const ev = (type: string, at: string, meta: Record<string, unknown> | null = null): RestartLike => ({
  type,
  at,
  meta,
});

describe("dedupeRestartNoise", () => {
  it("an update collapses to ONE line — drops the reconciled Restarted + Back online echo", () => {
    // As emitted around a real update (newest first): the platform's echo brackets the update.
    const events = [
      ev("running", "2026-08-05T00:42:00Z", { reason: "reconciled" }), // "Back online after a restart"
      ev("updated", "2026-08-05T00:41:00Z", { to: "abc" }), // "You updated this pod and it restarted"
      ev("suspended", "2026-08-05T00:40:30Z", { reason: "reconciled" }), // "Restarted (update or reboot)"
    ];
    const out = dedupeRestartNoise(events);
    expect(out.map((e) => e.type)).toEqual(["updated"]);
  });

  it("a spontaneous reboot keeps ONE line — the reconciled Restarted, minus the Back online tail", () => {
    const events = [
      ev("running", "2026-08-12T23:55:10Z", { reason: "reconciled" }), // Back online → dropped
      ev("suspended", "2026-08-12T23:54:00Z", { reason: "reconciled" }), // Restarted → kept (no update near)
    ];
    const out = dedupeRestartNoise(events);
    expect(out.map((e) => e.type)).toEqual(["suspended"]);
  });

  it("leaves a user suspend and real events untouched", () => {
    const events = [
      ev("secret_revealed", "2026-08-14T12:08:00Z", { key: "GMAIL_ADDRESS" }),
      ev("suspended", "2026-08-14T11:00:00Z", { reason: "owner" }), // "You suspended this pod" — not reconciled
      ev("agent_added", "2026-08-14T10:00:00Z", { agent: "codex" }),
    ];
    const out = dedupeRestartNoise(events);
    expect(out.map((e) => e.type)).toEqual(["secret_revealed", "suspended", "agent_added"]);
  });

  it("a reconciled Restarted far from an update is kept (not swallowed)", () => {
    const events = [
      ev("updated", "2026-08-06T22:56:00Z", { to: "x" }),
      ev("suspended", "2026-08-06T23:40:00Z", { reason: "reconciled" }), // 44min later → separate reboot, kept
    ];
    // Sorted newest-first for realism.
    const sorted = [...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const out = dedupeRestartNoise(sorted);
    expect(out.map((e) => e.type)).toEqual(["suspended", "updated"]);
  });
});
