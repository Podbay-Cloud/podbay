import { describe, expect, it } from "vitest";
import { effectiveAllowlist, BASE_ALLOWLIST, TRUSTED_ALLOWLIST } from "../src/egress.js";

describe("effectiveAllowlist", () => {
  it("full = no enforcement", () => {
    expect(effectiveAllowlist("full")).toEqual({ enforce: false, domains: [] });
  });
  it("none = base only, enforced", () => {
    const e = effectiveAllowlist("none");
    expect(e.enforce).toBe(true);
    expect(e.domains).toEqual([...BASE_ALLOWLIST].map((d) => d.toLowerCase()).sort());
  });
  it("trusted = base + curated dev set", () => {
    const e = effectiveAllowlist("trusted");
    expect(e.enforce).toBe(true);
    for (const d of [...BASE_ALLOWLIST, ...TRUSTED_ALLOWLIST]) expect(e.domains).toContain(d);
    expect(e.domains).toContain("github.com");
  });
  it("custom = base + author allow only (not the trusted set)", () => {
    const e = effectiveAllowlist("custom", ["example.com", "api.example.org"]);
    expect(e.enforce).toBe(true);
    expect(e.domains).toContain("example.com");
    expect(e.domains).toContain("anthropic.com"); // base always
    expect(e.domains).not.toContain("github.com"); // trusted set NOT included
  });
  it("always includes the agent API base so the agent works", () => {
    for (const p of ["none", "trusted", "custom"] as const) {
      expect(effectiveAllowlist(p, []).domains).toContain("anthropic.com");
    }
  });
});
