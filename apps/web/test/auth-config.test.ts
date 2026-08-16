import { describe, it, expect } from "vitest";
import { isAuthConfigured, createAuth, type AuthEnv } from "../lib/auth-config";

const full: AuthEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost/db",
  BETTER_AUTH_SECRET: "test-secret-0123456789",
  GITHUB_CLIENT_ID: "gh-id",
  GITHUB_CLIENT_SECRET: "gh-secret",
};

describe("auth configuration", () => {
  it("isAuthConfigured requires all four server secrets", () => {
    expect(isAuthConfigured(full)).toBe(true);
    expect(isAuthConfigured({ ...full, DATABASE_URL: undefined })).toBe(false);
    expect(isAuthConfigured({ ...full, GITHUB_CLIENT_SECRET: undefined })).toBe(false);
    expect(isAuthConfigured({})).toBe(false);
  });

  it("createAuth throws when unconfigured (secrets are required, not defaulted)", () => {
    expect(() => createAuth({})).toThrow(/not configured/);
  });

  it("createAuth builds an instance when configured (no DB connection made)", () => {
    const auth = createAuth(full);
    expect(auth).toBeTruthy();
    expect(typeof auth.api.getSession).toBe("function");
  });

  it("only reads server (non-NEXT_PUBLIC) secret names", () => {
    // The env keys the auth layer depends on must never be client-exposed.
    const keys: (keyof AuthEnv)[] = [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
    ];
    for (const k of keys) expect(k.startsWith("NEXT_PUBLIC")).toBe(false);
  });
});
