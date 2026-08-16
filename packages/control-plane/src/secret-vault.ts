import { and, eq } from "@podbay/db";
import { podSecrets, type Database } from "@podbay/db";
import { encryptSecret, decryptSecret } from "@podbay/shared/crypto";

/** Storage seam for per-pod app secrets (real = Drizzle, tests = in-memory). */
export interface SecretStore {
  get(podId: string, key: string): Promise<{ blob: string } | null>;
  upsert(podId: string, key: string, blob: string): Promise<void>;
  delete(podId: string, key: string): Promise<void>;
  /** Keys that have a value set, sorted. */
  listKeys(podId: string): Promise<string[]>;
  /** All ciphertext rows for a pod (for injection). */
  all(podId: string): Promise<{ key: string; blob: string }[]>;
}

export class DrizzleSecretStore implements SecretStore {
  constructor(private readonly db: Database) {}

  async get(podId: string, key: string) {
    const rows = await this.db
      .select({ blob: podSecrets.blob })
      .from(podSecrets)
      .where(and(eq(podSecrets.podId, podId), eq(podSecrets.key, key)));
    return rows[0] ?? null;
  }

  async upsert(podId: string, key: string, blob: string): Promise<void> {
    await this.db
      .insert(podSecrets)
      .values({ podId, key, blob, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [podSecrets.podId, podSecrets.key],
        set: { blob, updatedAt: new Date() },
      });
  }

  async delete(podId: string, key: string): Promise<void> {
    await this.db
      .delete(podSecrets)
      .where(and(eq(podSecrets.podId, podId), eq(podSecrets.key, key)));
  }

  async listKeys(podId: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: podSecrets.key })
      .from(podSecrets)
      .where(eq(podSecrets.podId, podId));
    return rows.map((r) => r.key).sort();
  }

  async all(podId: string): Promise<{ key: string; blob: string }[]> {
    return this.db
      .select({ key: podSecrets.key, blob: podSecrets.blob })
      .from(podSecrets)
      .where(eq(podSecrets.podId, podId));
  }
}

/**
 * Per-pod app secrets (BotFather token, API keys). Encrypts on the way in,
 * decrypts on the way out — the store only ever sees ciphertext, and plaintext
 * values are never returned to callers except `retrieveAll` (pod injection).
 */
export class SecretVault {
  constructor(
    private readonly store: SecretStore,
    private readonly key: Buffer,
  ) {}

  async set(podId: string, key: string, value: string): Promise<void> {
    await this.store.upsert(podId, key, encryptSecret(value, this.key));
  }

  async clear(podId: string, key: string): Promise<void> {
    await this.store.delete(podId, key);
  }

  /** Which keys have a value set (for the write-only UI — never the values). */
  async listKeys(podId: string): Promise<string[]> {
    return this.store.listKeys(podId);
  }

  /** Decrypted `{ KEY: value }` for injection into the pod. Server-only. */
  async retrieveAll(podId: string): Promise<Record<string, string>> {
    const rows = await this.store.all(podId);
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = decryptSecret(r.blob, this.key);
    return out;
  }

  /** Decrypted value for ONE key, or null if unset. Server-only — backs the
   * owner-gated, audited cockpit reveal (the caller MUST own the pod and audit it). */
  async retrieve(podId: string, key: string): Promise<string | null> {
    const row = await this.store.get(podId, key);
    return row ? decryptSecret(row.blob, this.key) : null;
  }
}
