import { describe, expect, it } from "vitest";
import { resolveSignInCallback } from "../lib/signin-callback";

describe("resolveSignInCallback", () => {
  it("preserves local paths, queries, and fragments", () => {
    expect(resolveSignInCallback("/new?env=telegram-bot#options")).toBe(
      "/new?env=telegram-bot#options",
    );
    expect(resolveSignInCallback("/pods/example/workspace")).toBe("/pods/example/workspace");
  });

  it("defaults missing destinations to the dashboard", () => {
    expect(resolveSignInCallback()).toBe("/dashboard");
    expect(resolveSignInCallback("")).toBe("/dashboard");
  });

  it.each([
    "https://example.com/account",
    "//example.com/account",
    "/\\example.com/account",
    "dashboard",
    "javascript:alert(1)",
    "http://[invalid",
  ])("rejects unsafe destination %s", (next) => {
    expect(resolveSignInCallback(next)).toBe("/dashboard");
  });
});
