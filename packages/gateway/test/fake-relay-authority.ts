import type { RelayAuthority } from "../src/config.js";

/**
 * An in-memory stand-in for the DB-backed RelayService, so the socket path can be
 * tested without a database. Codes are single-use, exactly like the real one.
 */
export class FakeRelayAuthority implements RelayAuthority {
  private readonly codes = new Map<string, string>();
  private seq = 0;
  readonly connected = new Map<string, string[]>();

  /** Pre-seed a specific code (tests that connect with a known string). */
  put(code: string, ownerId: string): void {
    this.codes.set(code, ownerId);
  }

  private readonly tokens = new Map<string, string>();

  async mintPairingCode(ownerId: string): Promise<{ code: string; expiresAt: number }> {
    const code = `mint-${ownerId}-${++this.seq}`;
    this.codes.set(code, ownerId);
    return { code, expiresAt: 4_102_444_800_000 }; // far future; tests do not exercise expiry here
  }
  async redeemPairingCode(code: string): Promise<string | null> {
    const owner = this.codes.get(code) ?? null;
    if (owner) this.codes.delete(code); // single use
    return owner;
  }
  async issueReconnectToken(ownerId: string): Promise<string> {
    const token = `tok-${ownerId}-${++this.seq}`;
    this.tokens.set(token, ownerId); // reusable, not consumed
    return token;
  }
  async validateReconnectToken(token: string): Promise<string | null> {
    return this.tokens.get(token) ?? null;
  }
  async markConnected(ownerId: string, loginDomains: string[]): Promise<void> {
    this.connected.set(ownerId, loginDomains);
  }
  async heartbeat(): Promise<void> {}
  async markDisconnected(ownerId: string): Promise<void> {
    this.connected.delete(ownerId);
  }
}
