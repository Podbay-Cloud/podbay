import "server-only";
import { createAppDb, githubConnections, eq } from "@podbay/db";
import { encryptSecret, decryptSecret } from "@podbay/shared/crypto";

/**
 * The user's short-lived GitHub connection for the BYO-repo launch flow
 * (docs/plans/byo-repo-plan.md). The token is stored ENCRYPTED (AES-256-GCM under
 * PODBAY_CRED_KEY — same as pod_secrets), TTL'd, and NEVER returned to the
 * client: callers get a connection status, repo names, or (server-only, for
 * launch) the decrypted token. Its long-term home stays the pod.
 */

// 24 hours, then reconnect. This is only the LAUNCH-side connection (the token's
// long-term home is the pod's own vault after launch), so the TTL just bounds how
// long an idle, unused token sits encrypted here. 8h was short enough that connecting
// and launching a pod the next work session already read as "disconnected"; a day
// covers a normal work rhythm without holding an unused OAuth token indefinitely.
const TTL_MS = 24 * 60 * 60 * 1000;

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
  if (new Date(row.expiresAt).getTime() < Date.now()) {
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
    expiresAt: new Date(now.getTime() + TTL_MS),
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
