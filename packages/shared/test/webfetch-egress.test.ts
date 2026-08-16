import { describe, it, expect } from "vitest";
import { effectiveAllowlist, webFetchDomains, WEBFETCH_RUNG_HOSTS } from "../src/egress.js";

/**
 * The capability and the network policy have to agree, or the agent is told to use
 * a reader service the proxy blocks — and that failure reads as a broken network,
 * not as a policy decision someone made.
 */
describe("web-fetch and egress agree", () => {
  it("allows the reader and archive hosts when the capability is on", () => {
    const e = effectiveAllowlist("trusted", [], { enabled: true });
    expect(e.enforce).toBe(true);
    expect(e.domains).toContain("r.jina.ai");
    expect(e.domains).toContain("web.archive.org");
  });

  it("does NOT allow them when the capability is off", () => {
    // The hosts are a consequence of declaring the capability, not a freebie for
    // every restricted env.
    const e = effectiveAllowlist("trusted", [], { enabled: false });
    expect(e.domains).not.toContain("r.jina.ai");
    expect(e.domains).not.toContain("web.archive.org");
  });

  it("honours a rung restriction — asking for fewer rungs opens fewer hosts", () => {
    const e = effectiveAllowlist("trusted", [], { enabled: true, rungs: ["api", "direct"] });
    expect(e.domains).not.toContain("r.jina.ai");
    const reader = effectiveAllowlist("trusted", [], { enabled: true, rungs: ["service"] });
    expect(reader.domains).toContain("r.jina.ai");
  });

  it("adds nothing under policy `full`, which enforces nothing at all", () => {
    expect(effectiveAllowlist("full", [], { enabled: true })).toEqual({ enforce: false, domains: [] });
  });

  it("claims no hosts for the rungs whose target is arbitrary", () => {
    // `api` and `direct` fetch whatever the research target is, so no allowlist can
    // cover them. Pretending otherwise would promise a working rung that isn't.
    expect(WEBFETCH_RUNG_HOSTS.api).toEqual([]);
    expect(WEBFETCH_RUNG_HOSTS.direct).toEqual([]);
    expect(webFetchDomains({ enabled: true, rungs: ["api", "direct"] })).toEqual([]);
  });

  it("keeps the base allowlist intact so the agent itself still works", () => {
    const e = effectiveAllowlist("none", [], { enabled: true });
    expect(e.domains).toContain("anthropic.com");
  });
});
