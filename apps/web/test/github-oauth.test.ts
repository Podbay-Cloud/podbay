import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("github-oauth", () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env.PODBAY_GITHUB_OAUTH_CLIENT_ID = "test-client-id";
    process.env.PODBAY_GITHUB_OAUTH_CLIENT_SECRET = "test-secret";
  });
  afterEach(() => {
    process.env = { ...OLD };
  });

  it("safeReturnPath allows same-origin relative paths, incl. query strings", async () => {
    const { safeReturnPath } = await import("../lib/github-oauth");
    expect(safeReturnPath("/dashboard")).toBe("/dashboard");
    expect(safeReturnPath("/dashboard/pods/new?env=byo-project")).toBe(
      "/dashboard/pods/new?env=byo-project",
    );
  });

  it("safeReturnPath rejects open-redirect vectors → /dashboard", async () => {
    const { safeReturnPath } = await import("../lib/github-oauth");
    for (const bad of ["//evil.com", "https://evil.com", "http://evil.com", "evil.com", "", null, undefined]) {
      expect(safeReturnPath(bad as string)).toBe("/dashboard");
    }
  });

  it("buildAuthorizeUrl carries client_id, repo scope, redirect_uri, state, and no-signup", async () => {
    const { buildAuthorizeUrl } = await import("../lib/github-oauth");
    const u = new URL(buildAuthorizeUrl("st4te", "https://podbay.cloud/api/github/oauth/callback"));
    expect(u.origin + u.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("test-client-id");
    expect(u.searchParams.get("scope")).toContain("repo");
    expect(u.searchParams.get("redirect_uri")).toBe("https://podbay.cloud/api/github/oauth/callback");
    expect(u.searchParams.get("state")).toBe("st4te");
    expect(u.searchParams.get("allow_signup")).toBe("false");
  });

  it("webFlowConfigured is true when both client id and secret are set", async () => {
    const { webFlowConfigured } = await import("../lib/github-oauth");
    expect(webFlowConfigured()).toBe(true); // env set in beforeEach before the first import
  });
});
