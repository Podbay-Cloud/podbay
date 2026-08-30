import { describe, it, expect, afterEach } from "vitest";
import { harnessEnabled, enabledHarnesses } from "@/lib/agent-harness";

const orig = process.env.PODBAY_AGENT_HARNESS;
afterEach(() => {
  if (orig === undefined) delete process.env.PODBAY_AGENT_HARNESS;
  else process.env.PODBAY_AGENT_HARNESS = orig;
});
const set = (v: string | undefined) => {
  if (v === undefined) delete process.env.PODBAY_AGENT_HARNESS;
  else process.env.PODBAY_AGENT_HARNESS = v;
};

describe("harnessEnabled — per-harness gate, default ON (agent-harness-toggle §1)", () => {
  it("UNSET → on (shipping the gate changes nothing)", () => {
    set(undefined);
    expect(harnessEnabled("t3")).toBe(true);
  });

  it("an allowlist containing the harness → on", () => {
    set("t3");
    expect(harnessEnabled("t3")).toBe(true);
  });

  it("an allowlist WITHOUT the harness → off (the disable)", () => {
    set("grok,opencode");
    expect(harnessEnabled("t3")).toBe(false);
  });

  it('"" and "none" → all off', () => {
    set("");
    expect(harnessEnabled("t3")).toBe(false);
    set("none");
    expect(harnessEnabled("t3")).toBe(false);
  });

  it("is case- and space-tolerant", () => {
    set("  T3 , GROK ");
    expect(harnessEnabled("t3")).toBe(true);
  });

  it("enabledHarnesses maps every known harness", () => {
    set("");
    expect(enabledHarnesses()).toEqual({ t3: false });
    set(undefined);
    expect(enabledHarnesses()).toEqual({ t3: true });
  });
});
