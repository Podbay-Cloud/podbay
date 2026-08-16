import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb } from "@podbay/db";
import { FetchMemory } from "../src/fetch-memory.js";
import { RelayService, RELAY_CODE_TTL_MS, RELAY_STALE_MS, RELAY_TOKEN_TTL_MS } from "../src/relay-service.js";

let relay: RelayService;
let mem: FetchMemory;
let close: () => Promise<void>;

beforeEach(async () => {
  const t = await createTestDb();
  relay = new RelayService(t.db);
  mem = new FetchMemory(t.db);
  close = t.close;
});
afterEach(async () => close());

describe("relay pairing codes", () => {
  it("mints a code an owner's relay can redeem exactly once", async () => {
    const { code } = await relay.mintPairingCode("owner-a");
    expect(await relay.redeemPairingCode(code)).toBe("owner-a");
    // A second redeem of the same code is refused — single use.
    expect(await relay.redeemPairingCode(code)).toBeNull();
  });

  it("refuses an expired code", async () => {
    const now = 1_000_000;
    const { code } = await relay.mintPairingCode("owner-a", now);
    const afterExpiry = now + RELAY_CODE_TTL_MS + 1;
    expect(await relay.redeemPairingCode(code, afterExpiry)).toBeNull();
  });

  it("refuses an unknown code", async () => {
    expect(await relay.redeemPairingCode("nope")).toBeNull();
    expect(await relay.redeemPairingCode("")).toBeNull();
  });

  it("lets two owners hold codes without collision", async () => {
    const a = await relay.mintPairingCode("owner-a");
    const b = await relay.mintPairingCode("owner-b");
    expect(await relay.redeemPairingCode(b.code)).toBe("owner-b");
    expect(await relay.redeemPairingCode(a.code)).toBe("owner-a");
  });
});

describe("relay reconnect tokens", () => {
  it("issues a reusable token an owner can reconnect with repeatedly", async () => {
    const token = await relay.issueReconnectToken("owner-a");
    // Reusable — validating does NOT consume it.
    expect(await relay.validateReconnectToken(token)).toBe("owner-a");
    expect(await relay.validateReconnectToken(token)).toBe("owner-a");
    expect(await relay.validateReconnectToken(token)).toBe("owner-a");
  });

  it("refuses an unknown or empty token", async () => {
    expect(await relay.validateReconnectToken("nope")).toBeNull();
    expect(await relay.validateReconnectToken("")).toBeNull();
  });

  it("refuses an expired token", async () => {
    const now = 1_000_000;
    const token = await relay.issueReconnectToken("owner-a", now);
    const past = now + RELAY_TOKEN_TTL_MS + 1;
    expect(await relay.validateReconnectToken(token, past)).toBeNull();
  });

  it("revoke drops all of an owner's tokens (relay reset)", async () => {
    const t1 = await relay.issueReconnectToken("owner-a");
    const t2 = await relay.issueReconnectToken("owner-a");
    await relay.revokeReconnectTokens("owner-a");
    expect(await relay.validateReconnectToken(t1)).toBeNull();
    expect(await relay.validateReconnectToken(t2)).toBeNull();
  });
});

describe("relay connection state", () => {
  it("reports connected only while the heartbeat is fresh", async () => {
    const t0 = 5_000_000;
    await relay.markConnected("owner-a", ["reddit.com"], t0);
    expect(await relay.isConnected("owner-a", t0)).toEqual({ connected: true, loginDomains: ["reddit.com"] });

    // Gateway crashed without deleting the row: a stale heartbeat reads as gone.
    const stale = t0 + RELAY_STALE_MS + 1;
    expect((await relay.isConnected("owner-a", stale)).connected).toBe(false);

    // A heartbeat inside the window keeps it alive.
    await relay.heartbeat("owner-a", stale);
    expect((await relay.isConnected("owner-a", stale)).connected).toBe(true);
  });

  it("a clean disconnect removes the connection", async () => {
    await relay.markConnected("owner-a", [], 1000);
    await relay.markDisconnected("owner-a");
    expect((await relay.isConnected("owner-a", 1000)).connected).toBe(false);
  });

  it("lists only fresh connections for the admin view", async () => {
    const t0 = 9_000_000;
    await relay.markConnected("owner-fresh", ["a.com"], t0);
    await relay.markConnected("owner-stale", [], t0 - RELAY_STALE_MS - 1);
    const live = await relay.listConnections(t0);
    expect(live.map((c) => c.ownerId)).toEqual(["owner-fresh"]);
  });
});

describe("relay traffic (from shared fetch memory, relay rung only)", () => {
  it("reports what the relay rung fetched, worst-behaved first, and nothing else", async () => {
    await mem.record("u", "reddit.com", "relay", "ok");
    await mem.record("u", "reddit.com", "relay", "ok");
    await mem.record("u", "x.com", "relay", "blocked");
    // A non-relay rung must NOT show up in relay traffic.
    await mem.record("u", "example.com", "direct", "ok");

    const traffic = await relay.traffic();
    expect(traffic.map((t) => t.domain)).toEqual(["x.com", "reddit.com"]);
    expect(traffic.find((t) => t.domain === "reddit.com")?.okCount).toBe(2);
    expect(traffic.some((t) => t.domain === "example.com")).toBe(false);
  });
});
