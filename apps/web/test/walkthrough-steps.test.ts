import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The walkthrough's connect step is agent-specific, and getting it wrong is INVISIBLE: a step
 * whose target never renders is skipped after ~3s of polling, so a Codex pod silently lost its
 * first and most important step and simply opened on "Settings". These assertions pin the
 * structure that prevents that — read from the source, since the component itself needs a DOM
 * and real cockpit targets to exercise.
 */
const src = readFileSync(
  path.join(process.cwd(), "components/connect-walkthrough.tsx"),
  "utf8",
);

describe("connect walkthrough steps", () => {
  it("has one connect step per agent, each gated to that agent", () => {
    // Claude's hand-off is a single link; Codex has none and needs pairing instead.
    expect(src).toMatch(/tour:\s*"continue-in-claude",\s*\n\s*agent:\s*"claude-code"/);
    expect(src).toMatch(/tour:\s*"pair-codex",\s*\n\s*agent:\s*"codex"/);
  });

  it("filters steps by the pod's agents rather than relying on skip-missing-target", () => {
    // The fallback polls ~3s per missing target, so a Codex user would stare at nothing
    // before their first step appeared. Filtering must happen up front.
    expect(src).toContain("STEPS.filter((s) => !s.agent || agents.includes(s.agent))");
  });

  it("keeps the shared tab steps ungated so every pod still gets them", () => {
    for (const tour of ["preview", "tab-settings", "tab-secrets", "tab-insights", "tab-admin"]) {
      const entry = src.slice(src.indexOf(`tour: "${tour}"`));
      const nextStep = entry.indexOf("},");
      expect(entry.slice(0, nextStep)).not.toContain("agent:");
    }
  });

  it("offers a visible way out on every step, not just the Escape key", () => {
    // Escape already dismissed the tour at any stage; without a control, that exit was
    // invisible. It is deliberately NOT gated on having seen a walkthrough before: that
    // would need cross-pod state (walkthroughSeenAt is per-pod) to withhold an exit the
    // keyboard already gave away.
    expect(src).toContain("Skip");
    expect(src).toMatch(/\{!last && \(/); // shown on every step except the last (which is "Done")
  });

  it("keeps the dismissive control away from the progressive ones", () => {
    // Skip sits in the LEFT group, Back/Next in the right, so a mis-click on Next can
    // never land on the control that ends the tour.
    const left = src.slice(src.indexOf("justify-between"), src.indexOf("Back"));
    expect(left).toContain("Skip");
  });
});
