import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentHomeLanding from "../app/landing-agent-home";
import { metadata } from "../app/preview/landing/agent-home/page";
import { LANDING_VARIANTS, isLandingVariant } from "../lib/landing-experiment-config";

describe("agent-home landing preview", () => {
  it("renders one focused promise, one proof story, and the desired signed-out action", async () => {
    const html = renderToStaticMarkup(await AgentHomeLanding({ user: null }));

    expect(html).toContain("A home your agent knows how to use.");
    expect(html).toContain("Give my agent a home");
    expect(html).toContain("Postgres ready");
    expect(html).toContain("Monday · 08:00");
    expect(html).toContain("Owner-only");
    expect(html).toContain("Product walkthrough · simulated project data");
    expect(html).not.toContain("prepared playbooks");
  });

  it("is a declared measured variant with instrumented CTAs and preview-safe tracking", () => {
    const source = readFileSync(
      new URL("../app/landing-agent-home.tsx", import.meta.url),
      "utf8",
    );

    const trackingSource = readFileSync(
      new URL("../app/landing-examples.tsx", import.meta.url),
      "utf8",
    );

    expect(LANDING_VARIANTS).toEqual(["outcomes", "agent-computer", "agent-home"]);
    expect(isLandingVariant("agent-home")).toBe(true);
    expect(source).toContain("TrackedLink");
    expect(source.match(/landing_primary_cta/g)).toHaveLength(2);
    expect(trackingSource).toContain('/preview/landing/');
  });

  it("keeps the forced preview out of search indexes", () => {
    expect(metadata.title).toBe("Landing preview: agent home");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toEqual({ canonical: "https://podbay.cloud/" });
  });
});
