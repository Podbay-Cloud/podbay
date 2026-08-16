import { describe, expect, it } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  shortHash,
  generateCredKey,
  credKeyFromEnv,
} from "../src/crypto.js";

const key = Buffer.from(generateCredKey(), "base64");

describe("credential crypto", () => {
  it("round-trips a secret", () => {
    const secret = JSON.stringify({ token: "sk-abc", refresh: "r-123" });
    const blob = encryptSecret(secret, key);
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain("sk-abc");
    expect(decryptSecret(blob, key)).toBe(secret);
  });

  it("uses a fresh IV each time (distinct ciphertext for same input)", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("rejects a tampered ciphertext", () => {
    const blob = encryptSecret("secret", key);
    const parts = blob.split(".");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 0xff; // flip a bit
    const tampered = [parts[0], parts[1], parts[2], ct.toString("base64")].join(".");
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it("rejects decryption under the wrong key", () => {
    const blob = encryptSecret("secret", key);
    const other = Buffer.from(generateCredKey(), "base64");
    expect(() => decryptSecret(blob, other)).toThrow();
  });

  it("shortHash is stable, non-reversible-looking, and change-sensitive", () => {
    expect(shortHash("a")).toBe(shortHash("a"));
    expect(shortHash("a")).not.toBe(shortHash("b"));
    expect(shortHash("a")).toHaveLength(16);
  });

  it("credKeyFromEnv validates length", () => {
    expect(() => credKeyFromEnv({ PODBAY_CRED_KEY: "short" } as NodeJS.ProcessEnv)).toThrow();
    expect(() => credKeyFromEnv({} as NodeJS.ProcessEnv)).toThrow();
    const good = generateCredKey();
    expect(credKeyFromEnv({ PODBAY_CRED_KEY: good } as NodeJS.ProcessEnv)).toHaveLength(32);
  });
});
