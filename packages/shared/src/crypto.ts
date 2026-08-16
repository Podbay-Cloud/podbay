import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";

/**
 * Authenticated symmetric encryption for the agent-credential vault. AES-256-GCM
 * with a random 96-bit IV per blob and the GCM auth tag, so any tampering with
 * the stored ciphertext fails decryption. Server-only (node:crypto) — imported
 * via the `@podbay/shared/crypto` subpath, never from the client bundle.
 *
 * Blob format: `v1.<iv b64>.<tag b64>.<ciphertext b64>`.
 */

const ALG = "aes-256-gcm";
const VERSION = "v1";

/** 32-byte key from PODBAY_CRED_KEY (base64). */
export function credKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.PODBAY_CRED_KEY;
  if (!raw) throw new Error("PODBAY_CRED_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("PODBAY_CRED_KEY must decode to 32 bytes");
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer = credKeyFromEnv()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(blob: string, key: Buffer = credKeyFromEnv()): string {
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("unsupported credential blob");
  const [, ivB, tagB, ctB] = parts;
  const decipher = createDecipheriv(ALG, key, Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Stable short digest for change-detection (never reversible to the secret). */
export function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Mint a new base64 vault key (ops helper). */
export function generateCredKey(): string {
  return randomBytes(32).toString("base64");
}
