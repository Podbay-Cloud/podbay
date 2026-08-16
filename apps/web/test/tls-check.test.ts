import { describe, it, expect } from "vitest";
import { classifyTlsHost } from "@/lib/tls-check";

// The on-demand-TLS `ask` guard (self-host-public-previews): only the dashboard host and real pod
// preview hosts may get a cert, so sslip.io <random>.<ip>.sslip.io spray can't exhaust Let's Encrypt.
describe("classifyTlsHost — Caddy on-demand-TLS authorization", () => {
  const BASE = "1.2.3.4.sslip.io";
  const DASH = "podbay.1.2.3.4.sslip.io";

  it("allows the dashboard host outright", () => {
    expect(classifyTlsHost(DASH, BASE, DASH)).toEqual({ allow: true });
    expect(classifyTlsHost(DASH.toUpperCase(), BASE, DASH)).toEqual({ allow: true }); // case-insensitive
  });

  it("defers a single-label host under the base to a pod lookup", () => {
    expect(classifyTlsHost(`eager-turtle-99b5.${BASE}`, BASE, DASH)).toEqual({ lookupPodId: "eager-turtle-99b5" });
  });

  it("refuses a host that isn't under the base", () => {
    expect(classifyTlsHost("evil.example.com", BASE, DASH)).toEqual({ allow: false });
    expect(classifyTlsHost("", BASE, DASH)).toEqual({ allow: false });
  });

  it("refuses a MULTI-label host under the base (only <id>.<base>, not a.b.<base>)", () => {
    expect(classifyTlsHost(`a.b.${BASE}`, BASE, DASH)).toEqual({ allow: false });
  });

  it("refuses everything when no base is configured (local mode)", () => {
    expect(classifyTlsHost(`x.${BASE}`, "", "")).toEqual({ allow: false });
  });

  it("dashboard == base (ip mode) still resolves both dashboard and pods", () => {
    // ip mode: DASH === BASE === <ip>.sslip.io; pods are <id>.<ip>.sslip.io.
    expect(classifyTlsHost(BASE, BASE, BASE)).toEqual({ allow: true }); // the dashboard/base itself
    expect(classifyTlsHost(`pod1.${BASE}`, BASE, BASE)).toEqual({ lookupPodId: "pod1" });
  });
});
