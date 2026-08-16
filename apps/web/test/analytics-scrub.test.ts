import { describe, it, expect } from "vitest";
import { scrubText, scrubUrl, scrubEventProperties } from "@/lib/analytics-scrub";

/**
 * Analytics ships exception messages, stack frames and the current URL to a third
 * party. Nothing we throw today carries a credential — but the leak arrives the day
 * someone throws an error containing a URL with a token, and review would not catch
 * it because the damage happens in a pipeline nobody is looking at.
 */
describe("scrubbing what analytics sends", () => {
  it("strips credentials out of an exception message", () => {
    const msg = 'fetch failed: https://x-token:abcdefghijklmnop@api.example.com/v1?token=abcdefghijklmnopqr';
    const out = scrubText(msg);
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out).toContain("REDACTED");
    // …while staying diagnosable: you still learn what failed and where.
    expect(out).toContain("fetch failed");
    expect(out).toContain("api.example.com");
  });

  it("redacts an OAuth code in a URL even though it is short", () => {
    // Length-based rules miss this: an authorization code is small enough to look
    // like an ordinary value.
    const out = scrubUrl("https://podbay.cloud/callback?code=abc123&state=xyz&tab=stats");
    expect(out).toBe("https://podbay.cloud/callback?code=REDACTED&state=REDACTED&tab=stats");
  });

  it("keeps ordinary URLs intact so events stay useful", () => {
    const url = "https://podbay.cloud/dashboard/pods/cheerful-donkey-6bc4?tab=settings";
    expect(scrubUrl(url)).toBe(url);
  });

  it("scrubs the exception payload PostHog actually sends", () => {
    const props = scrubEventProperties({
      $current_url: "https://podbay.cloud/signin?code=secret123",
      $exception_list: [{ type: "Error", value: "bad auth: token=abcdefghijklmnopqrst" }],
      pod_id: "cheerful-donkey-6bc4",
    });
    expect(props.$current_url).toContain("code=REDACTED");
    expect(JSON.stringify(props.$exception_list)).toContain("REDACTED");
    expect(JSON.stringify(props.$exception_list)).not.toContain("abcdefghijklmnopqrst");
    // Non-sensitive properties are untouched — over-scrubbing makes analytics
    // useless, which is how it ends up switched off entirely.
    expect(props.pod_id).toBe("cheerful-donkey-6bc4");
  });

  it("passes odd shapes through instead of throwing", () => {
    // A scrubber that throws takes the whole capture pipeline with it — a worse
    // failure than the one it prevents.
    expect(() => scrubEventProperties({ a: 1, b: null, c: { d: "x" }, e: [1, 2] })).not.toThrow();
    expect(scrubEventProperties({ $exception_list: "not-an-array" }).$exception_list).toBe("not-an-array");
  });
});
