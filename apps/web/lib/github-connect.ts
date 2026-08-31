import "server-only";
import { createAppDb, githubConnections, eq } from "@podbay/db";
import { encryptSecret, decryptSecret } from "@podbay/shared/crypto";

/**
 * The owner's DURABLE GitHub connection — the single source of truth every pod draws from
 * (global-github-connection). The token is stored ENCRYPTED (AES-256-GCM under PODBAY_CRED_KEY —
 * same as pod_secrets) and NEVER returned to the client: callers get a connection status, repo
 * names, or (server-only, for launch + the pod fan-out) the decrypted token. It does not expire on
 * its own; the owner disconnects/reconnects it explicitly in dashboard Settings.
 */

export interface ConnectionStatus {
  connected: boolean;
  login: string | null;
}

export interface Repo {
  fullName: string; // "owner/name"
  private: boolean;
  updatedAt: string; // ISO
}

/** Live (non-expired) connection row, cleaning up an expired one. */
async function activeRow(userId: string) {
  const rows = await createAppDb()
    .select()
    .from(githubConnections)
    .where(eq(githubConnections.userId, userId));
  const row = rows[0];
  if (!row) return null;
  // A durable connection (expiresAt NULL) never self-expires — it is the owner-managed source of
  // truth. A legacy TTL'd row (non-null expiresAt) is still dropped once past its deadline, so old
  // 24h launch-buffer rows age out normally during the rollout.
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    await disconnect(userId).catch(() => {});
    return null;
  }
  return row;
}

async function fetchLogin(token: string): Promise<string> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error("GitHub token was rejected");
  const d = (await res.json()) as { login?: string };
  if (!d.login) throw new Error("GitHub account has no login");
  return d.login;
}

/** Store (replace) the user's connection: encrypt the token, record the login + TTL. */
export async function storeConnection(userId: string, token: string): Promise<{ login: string }> {
  const login = await fetchLogin(token); // validates the token too
  const now = new Date();
  const db = createAppDb();
  await db.delete(githubConnections).where(eq(githubConnections.userId, userId));
  await db.insert(githubConnections).values({
    userId,
    tokenEnc: encryptSecret(token),
    login,
    connectedAt: now,
    // Durable: the owner manages this connection explicitly (Settings → Disconnect/Reconnect); it
    // does not self-expire. Legacy rows carrying a TTL still age out via activeRow().
    expiresAt: null,
  });
  return { login };
}

/** Connection status — NEVER the token. Expired connections read as disconnected. */
export async function connectionStatus(userId: string): Promise<ConnectionStatus> {
  const row = await activeRow(userId);
  return row ? { connected: true, login: row.login } : { connected: false, login: null };
}

/** The decrypted token — SERVER-ONLY (listRepos + launch injection). Null if none/expired. */
export async function getConnectionToken(userId: string): Promise<string | null> {
  const row = await activeRow(userId);
  if (!row) return null;
  try {
    return decryptSecret(row.tokenEnc);
  } catch {
    return null;
  }
}

export async function disconnect(userId: string): Promise<void> {
  await createAppDb().delete(githubConnections).where(eq(githubConnections.userId, userId));
}

/** The user's repos, most-recently-updated first. Names only leave the server. */
export async function listRepos(userId: string): Promise<Repo[]> {
  const token = await getConnectionToken(userId);
  if (!token) return [];
  // Hermetic browser tests need the connected-account path without calling GitHub. Keep the seam
  // double-gated so production can never substitute scripted repository data accidentally.
  const fakeRepos = process.env.PODBAY_TEST_LOGIN === "1" ? process.env.PODBAY_FAKE_GITHUB_REPOS : undefined;
  if (fakeRepos) return JSON.parse(fakeRepos) as Repo[];
  const res = await fetch(
    "https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member",
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!res.ok) return [];
  const arr = (await res.json()) as Array<{ full_name: string; private: boolean; updated_at: string }>;
  return arr
    .filter((r) => r.full_name)
    .map((r) => ({ fullName: r.full_name, private: Boolean(r.private), updatedAt: r.updated_at }));
}
