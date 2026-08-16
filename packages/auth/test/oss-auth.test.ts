import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, account, user, type Database } from "@podbay/db";
import {
  isOssEdition,
  isAuthConfigured,
  ownerCredentialExists,
  resolveOwnerId,
  ossTrustedOrigins,
  type AuthEnv,
} from "../src/index.js";

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (close) await close();
  close = null;
});
async function freshDb(): Promise<Database> {
  const t = await createTestDb();
  close = t.close;
  return t.db;
}

describe("OSS auth config (self-host-auth-gate)", () => {
  it("isOssEdition reads PODBAY_EDITION", () => {
    expect(isOssEdition({ PODBAY_EDITION: "oss" })).toBe(true);
    expect(isOssEdition({ PODBAY_EDITION: "cloud" })).toBe(false);
    expect(isOssEdition({})).toBe(false);
  });

  it("OSS is configured on DB + secret alone (no GitHub creds required)", () => {
    const oss: AuthEnv = { PODBAY_EDITION: "oss", DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "s" };
    expect(isAuthConfigured(oss)).toBe(true);
    // Missing the secret → not configured.
    expect(isAuthConfigured({ PODBAY_EDITION: "oss", DATABASE_URL: "postgres://x" })).toBe(false);
  });

  it("cloud still requires GitHub creds", () => {
    const base: AuthEnv = { DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "s" };
    expect(isAuthConfigured(base)).toBe(false); // no GitHub
    expect(isAuthConfigured({ ...base, GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "sec" })).toBe(true);
  });
});

describe("ossTrustedOrigins — CSRF origin from the request's own host", () => {
  const H = (o: Record<string, string>) => new Headers(o);

  it("derives the origin from Host (VPS IP:port), scheme from x-forwarded-proto", () => {
    // Documentation-range IP (RFC 5737) — never a real server's address in a test fixture.
    expect(ossTrustedOrigins(H({ host: "203.0.113.10:8080" }))).toEqual(["http://203.0.113.10:8080"]);
    expect(ossTrustedOrigins(H({ host: "podbay.example.com", "x-forwarded-proto": "https" }))).toEqual([
      "https://podbay.example.com",
    ]);
  });

  it("prefers x-forwarded-host and takes the first x-forwarded-proto", () => {
    expect(
      ossTrustedOrigins(H({ host: "web:3000", "x-forwarded-host": "podbay.example.com", "x-forwarded-proto": "https, http" })),
    ).toEqual(["https://podbay.example.com"]);
  });

  it("returns [] when there's no host (can't vouch for an origin) — better-auth then rejects", () => {
    expect(ossTrustedOrigins(undefined)).toEqual([]);
    expect(ossTrustedOrigins(H({}))).toEqual([]);
  });
});

describe("OSS owner helpers (single-tenant)", () => {
  it("no owner until a credential account exists", async () => {
    const db = await freshDb();
    expect(await ownerCredentialExists(db)).toBe(false);
    expect(await resolveOwnerId(db)).toBeNull();

    // A user row WITHOUT a password credential is not an owner (e.g. a stray seed).
    await db.insert(user).values({ id: "u1", name: "Stray", email: "stray@localhost" });
    expect(await ownerCredentialExists(db)).toBe(false);
    expect(await resolveOwnerId(db)).toBeNull();
  });

  it("resolves the owner from the credentialed account", async () => {
    const db = await freshDb();
    await db.insert(user).values({ id: "owner1", name: "Owner", email: "owner@localhost", approved: true });
    await db.insert(account).values({
      id: "acc1",
      accountId: "owner@localhost",
      providerId: "credential",
      userId: "owner1",
      password: "hashed-secret",
    });
    expect(await ownerCredentialExists(db)).toBe(true);
    expect(await resolveOwnerId(db)).toBe("owner1");
  });

  it("a passwordless (OAuth) account is not treated as an owner credential", async () => {
    const db = await freshDb();
    await db.insert(user).values({ id: "gh", name: "GH", email: "gh@example.com" });
    await db.insert(account).values({
      id: "acc2",
      accountId: "12345",
      providerId: "github",
      userId: "gh",
      password: null,
    });
    expect(await ownerCredentialExists(db)).toBe(false);
  });
});
