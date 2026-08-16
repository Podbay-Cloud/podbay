import { describe, it, expect } from "vitest";
import { RELAY_LIMITS, classifyRelayRefusal } from "../src/relay.js";

describe("relay limits + refusal classification", () => {
  it("exposes the caps the gateway enforces and the pod reports", () => {
    expect(RELAY_LIMITS.maxPerPod).toBe(32);
    expect(RELAY_LIMITS.maxPerOwner).toBe(64);
    expect(RELAY_LIMITS.ratePerDomainPerMin).toBe(120);
  });

  it("distinguishes a soft, retryable limit from a hard 'relay down'", () => {
    // The whole point (afisha-crawler 2026-08-09): a fail-closed workload must tell a capacity
    // ceiling (back off + retry) from a missing relay (treat as down).
    expect(classifyRelayRefusal("too many open connections for this pod")).toBe("capacity");
    expect(classifyRelayRefusal("too many open connections for this relay")).toBe("capacity");
    expect(classifyRelayRefusal("rate limit for this site")).toBe("rate-limit");
    expect(classifyRelayRefusal("no relay connected")).toBe("no-relay");
    expect(classifyRelayRefusal("relay unavailable")).toBe("unreachable");
    expect(classifyRelayRefusal("target not allowed")).toBe("blocked");
    expect(classifyRelayRefusal("no-answer")).toBe("other");
    expect(classifyRelayRefusal(undefined)).toBe("other");
  });
});
