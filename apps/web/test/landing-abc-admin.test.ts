import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { wilsonInterval } from "../lib/landing-experiment-store";

const detailPage = readFileSync(
  new URL("../app/admin/experiments/[id]/page.tsx", import.meta.url),
  "utf8",
);
const controls = readFileSync(
  new URL("../components/experiment-controls.tsx", import.meta.url),
  "utf8",
);
const rootPage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../../packages/db/drizzle/0033_expand_landing_variants.sql", import.meta.url),
  "utf8",
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("A/B/C delivery and admin diagnostics", () => {
  it("serves agent-computer to everyone as an A/A validation; outcomes kept but never shown", async () => {
    vi.stubEnv("PODBAY_LANDING_EXPERIMENT_MODE", "");
    vi.resetModules();
    const config = await import("../lib/landing-experiment-config");
    const active = config.ACTIVE_LANDING_EXPERIMENT;
    // No measured winner is read — everyone SEES agent-computer (the validationVariant).
    expect(active.deliveryMode).toBe("validation");
    expect(active.validationVariant).toBe("agent-computer");
    // A/A: 50/50 assignment across two arms; the outcomes arm's CONTENT is never served.
    expect(active.allocation).toEqual({ "agent-computer": 50, outcomes: 50 });
    expect(active.variants).not.toContain("agent-home");
    expect(active.id).toBe("landing-agent-computer-2026-08-real-home-cloud");
    expect(active.cookie.variant).toBe("pb_landing_agent_computer_real_home_variant");
    expect(config.AGENT_COMPUTER_LANDING_TAXONOMY_2026_08.deliveryMode).toBe("historical");
    expect(config.AGENT_COMPUTER_LANDING_TAXONOMY_2026_08.id).toBe(
      "landing-agent-computer-2026-08-taxonomy",
    );
    expect(config.AGENT_COMPUTER_LANDING_2026_08.deliveryMode).toBe("historical");

    // The dormant August A/B/C definition is retained and STILL honours the abc switch,
    // so a future measured test can be re-activated cleanly.
    vi.stubEnv("PODBAY_LANDING_EXPERIMENT_MODE", "abc");
    vi.resetModules();
    const c2 = await import("../lib/landing-experiment-config");
    expect(c2.AUGUST_LANDING_EXPERIMENT.deliveryMode).toBe("measured");
    expect(c2.AUGUST_LANDING_EXPERIMENT.allocation).toEqual({
      outcomes: 34,
      "agent-computer": 33,
      "agent-home": 33,
    });
  });

  it("renders all semantic variants without a binary root ternary", () => {
    expect(rootPage).toContain('variant === "agent-home"');
    expect(rootPage).toContain('variant === "agent-computer"');
    expect(rootPage).toContain('deliveryMode === "measured"');
  });

  it("uses definition-driven controls, previews, progress, intervals, and balance state", () => {
    expect(controls).toContain("variants.map");
    expect(controls).toContain("Historical definition");
    expect(detailPage).toContain("Variant previews");
    expect(detailPage).toContain("Operational sample progress");
    expect(detailPage).toContain("Assignment-balance warning");
    expect(detailPage).toContain("Acquisition by variant");
    expect(detailPage).not.toContain("50 / 50");
  });

  it("computes bounded Wilson intervals and preserves the zero-data state", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    const bounds = wilsonInterval(10, 100);
    expect(bounds?.[0]).toBeGreaterThan(0);
    expect(bounds?.[0]).toBeLessThan(0.1);
    expect(bounds?.[1]).toBeGreaterThan(0.1);
    expect(bounds?.[1]).toBeLessThan(1);
  });

  it("expands every persisted variant constraint without rewriting experiment rows", () => {
    expect(migration.match(/agent-home/g)?.length).toBe(5);
    expect(migration).toContain("landing_runs_pin_check");
    expect(migration).toContain("landing_assignments_variant_check");
    expect(migration).toContain("landing_events_variant_check");
    expect(migration).toContain("landing_audit_pin_check");
    expect(migration).not.toMatch(/UPDATE\s+"landing_experiment_/i);
  });
});
