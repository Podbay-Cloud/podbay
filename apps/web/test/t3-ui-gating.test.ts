import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * agent-harness-toggle §2: every T3 UI choke point must be gated on the harness flag, so turning T3
 * off hides it from launch AND the cockpit. Source-level (mirrors the H2 gate + §3 action tests) — a
 * runtime render test would need a component harness this repo doesn't have, and the point here is to
 * catch a regression where someone removes a gate. The runtime flag itself is covered in
 * agent-harness.test.ts; the action guards in t3-harness-guard.test.ts.
 */
const read = (rel: string) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8");
const cockpit = read("components/pod-cockpit.tsx");
const launch = read("components/launch-configure.tsx");

describe("T3 UI is gated on the harness flag (agent-harness-toggle §2)", () => {
  it("launch: the Control picker is wrapped in {t3Enabled && ...}", () => {
    // The picker block opens right after the gate.
    expect(launch).toMatch(/\{t3Enabled && \(\s*<div className="flex flex-col gap-2\.5">\s*<Label>Control<\/Label>/);
  });

  it("launch: a saved t3 draft only restores when t3Enabled", () => {
    expect(launch).toContain('draft.control === "t3" && t3Enabled');
  });

  it("cockpit: T3ConnectPanel is mounted only when enabled OR already in T3 control (keeps off-switch)", () => {
    expect(cockpit).toMatch(/\{\(t3Enabled \|\| t3InControl\) && \(\s*<T3ConnectPanel/);
  });

  it("cockpit: the ?enableT3=1 auto-enable latch is gated", () => {
    expect(cockpit).toContain('t3Enabled && searchParams.get("enableT3") === "1"');
  });

  it("cockpit: the t3connect wizard return is gated (a forged ?wiz can't open it)", () => {
    expect(cockpit).toContain('wiz === "t3connect" && t3Enabled');
  });

  it("cockpit: renew-then-t3 is gated, but generic renew-token is NOT", () => {
    expect(cockpit).toContain('wiz === "renew-then-t3" && t3Enabled');
    // renew-token stays reachable (generic setup-token renew, not T3-only)
    expect(cockpit).toMatch(/wiz === "renew-token" \|\| \(wiz === "renew-then-t3" && t3Enabled\)/);
  });

  it("cockpit: the T3Enabling (disable-progress) return is deliberately NOT flag-gated", () => {
    // It's state-driven (not ?wiz-reachable) and shows during a disable; the action guards prevent it
    // opening via a disabled enable. A gate here would break turning OFF an already-T3 pod.
    expect(cockpit).toContain("if (t3Enabling && !connecting && !onboarding) {");
  });
});
