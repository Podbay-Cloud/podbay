import { describe, it, expect } from "vitest";
import { computeAuthSteps, type ProviderAuthState } from "@/lib/provider-auth-steps";

const state = (over: Partial<ProviderAuthState> & { id: ProviderAuthState["id"] }): ProviderAuthState => ({
  authed: false,
  agentAuth: null,
  ...over,
});

describe("computeAuthSteps — one flow, all entry points", () => {
  it("fresh launch under Podbay, nothing signed in → subscription + device", () => {
    const steps = computeAuthSteps({ providers: ["claude-code", "codex"], mode: "podbay", current: [] });
    expect(steps).toEqual([
      { provider: "claude-code", kind: "claude-subscription" },
      { provider: "codex", kind: "codex-device" },
    ]);
  });

  it("fresh launch under T3 → Claude uses the setup-token, Codex device-auth", () => {
    const steps = computeAuthSteps({ providers: ["claude-code", "codex"], mode: "t3", current: [] });
    expect(steps).toEqual([
      { provider: "claude-code", kind: "claude-setup-token" },
      { provider: "codex", kind: "codex-device" },
    ]);
  });

  it("PARTIAL: switch to T3 with Claude(subscription) + Codex both signed in → only Claude's setup-token", () => {
    const steps = computeAuthSteps({
      providers: ["claude-code", "codex"],
      mode: "t3",
      current: [state({ id: "claude-code", authed: true, agentAuth: "subscription" }), state({ id: "codex", authed: true })],
    });
    expect(steps).toEqual([{ provider: "claude-code", kind: "claude-setup-token" }]);
  });

  it("ADD-PROVIDER: a T3 pod already on the setup-token adds Codex → only Codex device-auth", () => {
    const steps = computeAuthSteps({
      providers: ["claude-code", "codex"],
      mode: "t3",
      current: [state({ id: "claude-code", authed: true, agentAuth: "setup-token" })],
    });
    expect(steps).toEqual([{ provider: "codex", kind: "codex-device" }]);
  });

  it("setup-token is NOT adequate under Podbay control → Claude needs a subscription login (velsa's rule)", () => {
    const steps = computeAuthSteps({
      providers: ["claude-code"],
      mode: "podbay",
      current: [state({ id: "claude-code", authed: true, agentAuth: "setup-token" })],
    });
    expect(steps).toEqual([{ provider: "claude-code", kind: "claude-subscription" }]);
  });

  it("nothing to do when every provider is already correct", () => {
    expect(
      computeAuthSteps({
        providers: ["claude-code", "codex"],
        mode: "podbay",
        current: [state({ id: "claude-code", authed: true, agentAuth: "subscription" }), state({ id: "codex", authed: true })],
      }),
    ).toEqual([]);
    expect(
      computeAuthSteps({
        providers: ["claude-code", "codex"],
        mode: "t3",
        current: [state({ id: "claude-code", authed: true, agentAuth: "setup-token" }), state({ id: "codex", authed: true })],
      }),
    ).toEqual([]);
  });

  it("only computes steps for the providers requested", () => {
    const steps = computeAuthSteps({ providers: ["codex"], mode: "t3", current: [] });
    expect(steps).toEqual([{ provider: "codex", kind: "codex-device" }]);
  });
});
