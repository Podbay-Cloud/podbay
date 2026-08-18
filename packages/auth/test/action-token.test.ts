import { describe, it, expect, beforeAll } from "vitest";
import { mintActionToken, verifyActionToken } from "../src/action-token.js";

// A deterministic 32-byte base64 key so encryptSecret/decryptSecret have a cred key in the test env.
beforeAll(() => {
  process.env.PODBAY_CRED_KEY = Buffer.alloc(32, 7).toString("base64");
});

const NOW = 1_000_000_000_000;

describe("admin one-click action tokens", () => {
  it("round-trips an approve/later action + user id", () => {
    for (const action of ["approve", "later"] as const) {
      const t = mintActionToken(action, "user-123", NOW);
      expect(verifyActionToken(t, NOW)).toEqual({ action, userId: "user-123" });
    }
  });

  it("rejects an EXPIRED token", () => {
    const t = mintActionToken("approve", "u1", NOW, 1000); // 1s ttl
    expect(verifyActionToken(t, NOW + 2000)).toBeNull();
    expect(verifyActionToken(t, NOW + 500)).not.toBeNull(); // still inside the window
  });

  it("rejects a TAMPERED / garbage token (can't forge an approval)", () => {
    const t = mintActionToken("approve", "u1", NOW);
    expect(verifyActionToken(t.slice(0, -4) + "XXXX", NOW)).toBeNull();
    expect(verifyActionToken("not-a-token", NOW)).toBeNull();
    expect(verifyActionToken("", NOW)).toBeNull();
  });

  it("a token minted with a DIFFERENT key does not verify (key-bound capability)", () => {
    const t = mintActionToken("approve", "u1", NOW);
    process.env.PODBAY_CRED_KEY = Buffer.alloc(32, 9).toString("base64"); // rotate the key
    expect(verifyActionToken(t, NOW)).toBeNull();
    process.env.PODBAY_CRED_KEY = Buffer.alloc(32, 7).toString("base64"); // restore for other tests
  });
});
