import { describe, it, expect } from "vitest";
import { canonicalRedirectHost } from "../lib/canonical-host";

describe("canonicalRedirectHost", () => {
  it("redirects www to the apex host", () => {
    expect(canonicalRedirectHost("www.podbay.cloud")).toBe("podbay.cloud");
  });

  it("leaves the apex host alone", () => {
    expect(canonicalRedirectHost("podbay.cloud")).toBeNull();
  });

  it("does not touch non-www hosts (fly.dev, gateway, localhost)", () => {
    expect(canonicalRedirectHost("podbay-web.fly.dev")).toBeNull();
    expect(canonicalRedirectHost("gw.podbay.cloud")).toBeNull();
    expect(canonicalRedirectHost("localhost:3000")).toBeNull();
    expect(canonicalRedirectHost(null)).toBeNull();
  });

  it("preserves a port when present (local/dev)", () => {
    expect(canonicalRedirectHost("www.podbay.cloud:3000")).toBe("podbay.cloud:3000");
  });
});
