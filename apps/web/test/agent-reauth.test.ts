import { describe, it, expect } from "vitest";
import { claudeReauthMode } from "@/lib/agent-reauth";

describe("claudeReauthMode — setup-token renews, everything else reconnects (§5.1)", () => {
  it("a setup-token pod RENEWS (non-destructive, mint a fresh 1-year token)", () => {
    expect(claudeReauthMode("setup-token")).toBe("renew");
  });

  it("a subscription pod RECONNECTS (full re-login, session-interrupting)", () => {
    expect(claudeReauthMode("subscription")).toBe("reconnect");
  });

  it("defaults to reconnect for an unknown / unset mode — only an EXPLICIT setup-token renews", () => {
    expect(claudeReauthMode(null)).toBe("reconnect");
    expect(claudeReauthMode(undefined)).toBe("reconnect");
    expect(claudeReauthMode("api-key")).toBe("reconnect");
  });
});
