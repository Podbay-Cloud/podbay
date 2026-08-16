import { describe, it, expect } from "vitest";
import { normalizeDomain } from "../src/domain.js";

describe("normalizeDomain reduces a URL to a bare host", () => {
  it("normalises scheme, www, path and trailing dot", () => {
    expect(normalizeDomain("https://WWW.Reddit.com/r/x")).toBe("reddit.com");
    expect(normalizeDomain("example.com.")).toBe("example.com");
  });

  it("refuses a bare TLD and non-domains", () => {
    expect(() => normalizeDomain("com")).toThrow();
    expect(() => normalizeDomain("not a domain")).toThrow();
  });
});
