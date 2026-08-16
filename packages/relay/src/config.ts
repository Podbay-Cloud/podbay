import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * The relay's state on the owner's machine. Disk IS the shared state between the
 * background daemon and the `login`/`dashboard`/`stop` commands — no IPC needed: login
 * writes here and the daemon re-reads it per fetch; dashboard reads the audit log; stop
 * reads the pidfile. Simpler and more robust than a socket.
 */
export interface RelayConfig {
  gatewayUrl?: string;
  /** Domains the owner explicitly signed into — these, and only these, are fetched
   * with their session. Everything else is a clean, cookieless fetch. */
  loginDomains: string[];
  consentedAt?: string;
  /** Durable reconnect token, handed to us at pairing. We reconnect with THIS (not the
   * one-time code) so a gateway restart or network blip does not force re-pairing. */
  reconnectToken?: string;
  /** Explicit local denials. Clean public-web access remains open by default. */
  pausedPodIds?: string[];
  blockedDomains?: string[];
  retentionDays?: 7 | 30 | 90;
}

const dir = () => process.env.PB_RELAY_HOME ?? path.join(homedir(), ".podbay", "relay");
const file = () => path.join(dir(), "config.json");
export const profileDir = () => path.join(dir(), "profile");
export const pidFile = () => path.join(dir(), "relay.pid");
export const auditFile = () => path.join(dir(), "fetch-audit.jsonl");
export const eventsDir = () => path.join(dir(), "events");
export const dashboardRuntimeFile = () => path.join(dir(), "dashboard.json");

function defaults(value: Partial<RelayConfig> = {}): RelayConfig {
  return {
    ...value,
    loginDomains: Array.isArray(value.loginDomains) ? value.loginDomains : [],
    pausedPodIds: Array.isArray(value.pausedPodIds) ? value.pausedPodIds : [],
    blockedDomains: Array.isArray(value.blockedDomains) ? value.blockedDomains : [],
    retentionDays: value.retentionDays === 7 || value.retentionDays === 90 ? value.retentionDays : 30,
  };
}

export function load(): RelayConfig {
  try {
    return defaults(JSON.parse(readFileSync(file(), "utf8")) as Partial<RelayConfig>);
  } catch {
    return defaults();
  }
}

export function save(cfg: RelayConfig): void {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  writeFileSync(file(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function addLoginDomain(domain: string): void {
  const cfg = load();
  if (!cfg.loginDomains.includes(domain)) cfg.loginDomains.push(domain);
  save(cfg);
}

const normalizedDomain = (value: string): string => value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
const normalizedPodId = (value: string): string => value.trim().slice(0, 160);

export function setPodPaused(podId: string, paused: boolean): RelayConfig {
  const cfg = load();
  const id = normalizedPodId(podId);
  if (!id) return cfg;
  const values = new Set(cfg.pausedPodIds ?? []);
  if (paused) values.add(id); else values.delete(id);
  cfg.pausedPodIds = [...values].sort();
  save(cfg);
  return cfg;
}

export function setDomainBlocked(domain: string, blocked: boolean): RelayConfig {
  const cfg = load();
  const value = normalizedDomain(domain);
  if (!value || /[\s/:@?#]/.test(value)) return cfg;
  const values = new Set(cfg.blockedDomains ?? []);
  if (blocked) values.add(value); else values.delete(value);
  cfg.blockedDomains = [...values].sort();
  save(cfg);
  return cfg;
}

export function setRetentionDays(days: number): RelayConfig {
  if (days !== 7 && days !== 30 && days !== 90) throw new Error("retention must be 7, 30, or 90 days");
  const cfg = load();
  cfg.retentionDays = days;
  save(cfg);
  return cfg;
}

export function revokeLoginDomain(domain: string): RelayConfig {
  const value = normalizedDomain(domain);
  const cfg = load();
  cfg.loginDomains = cfg.loginDomains.filter((item) => item !== value);
  save(cfg);
  return cfg;
}

export function isPodPaused(cfg: RelayConfig, podId?: string): boolean {
  return !!podId && (cfg.pausedPodIds ?? []).includes(podId);
}

export function isDomainBlocked(cfg: RelayConfig, host: string): boolean {
  return (cfg.blockedDomains ?? []).some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function resetProfile(): void {
  if (existsSync(profileDir())) rmSync(profileDir(), { recursive: true, force: true });
  const cfg = load();
  cfg.loginDomains = [];
  // Forget the reconnect token too — reset means fully un-pair; the next start needs a
  // fresh code. (The gateway-side token expires on its own; a security revoke is a
  // separate operation.)
  delete cfg.reconnectToken;
  save(cfg);
}
