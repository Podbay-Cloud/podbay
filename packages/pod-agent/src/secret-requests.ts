import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Secrets the agent has ASKED the owner for, from inside the pod.
 *
 * The agent declares "I need OPENAI_API_KEY, here's why" (via `podbay secrets
 * request`); this records the ask so the pod dashboard can render it as an input the
 * owner fills. It holds the NAME and the reason only — never a value. The filled value
 * travels the existing encrypted-vault path and lands in `/etc/podbay/secrets.env`;
 * this file is just the request queue.
 *
 * Pure over an injected path so the parsing/dedup is testable without a filesystem
 * dance in the server.
 */

export interface SecretRequest {
  key: string;
  description: string;
  /** ISO timestamp of the most recent ask for this key. */
  at: string;
}

/** Env-var name shape — matches the control plane's `setSecret` validation, so a
 * request can only ever name a key that is actually settable. */
const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export function readRequests(path: string): SecretRequest[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return []; // absent/unreadable/corrupt → no requests, never an error
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (r): r is { key: string; description?: unknown; at?: unknown } =>
        !!r && typeof (r as { key?: unknown }).key === "string" && KEY_RE.test((r as { key: string }).key),
    )
    .map((r) => ({
      key: r.key,
      description: typeof r.description === "string" ? r.description : "",
      at: typeof r.at === "string" ? r.at : "",
    }));
}

/**
 * Record (or refresh) a request. Dedups by key — a repeated ask updates the reason and
 * timestamp rather than stacking. Throws on a key the vault could never accept, so the
 * agent finds out immediately instead of the dashboard silently dropping it.
 */
export function addRequest(path: string, key: string, description: string, now: string): SecretRequest[] {
  if (!KEY_RE.test(key)) throw new Error(`invalid key '${key}': must be UPPER_SNAKE_CASE`);
  const next = [
    ...readRequests(path).filter((r) => r.key !== key),
    { key, description: description.slice(0, 300), at: now },
  ];
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    /* best-effort */
  }
  writeFileSync(path, JSON.stringify(next, null, 2));
  return next;
}

/** Drop a request once it is satisfied (or withdrawn). */
export function removeRequest(path: string, key: string): SecretRequest[] {
  const next = readRequests(path).filter((r) => r.key !== key);
  writeFileSync(path, JSON.stringify(next, null, 2));
  return next;
}

/**
 * Keys already set (non-empty) in an env file like `/etc/podbay/secrets.env`.
 *
 * Used to auto-hide a request the moment its secret exists — so filling a secret in
 * the dashboard makes the request disappear on the next read, with no explicit
 * dismiss step to wire through four layers.
 */
export function setKeysIn(envPath: string): Set<string> {
  const keys = new Set<string>();
  let text: string;
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return keys;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m && m[2] && m[2] !== "''" && m[2] !== '""') keys.add(m[1]!);
  }
  return keys;
}
