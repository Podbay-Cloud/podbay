import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Alert, AlertState } from "./types";

const FILE = path.join(process.cwd(), "data", "alerts.json");

async function readAll(): Promise<Alert[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Alert[];
  } catch {
    return [];
  }
}

async function writeAll(alerts: Alert[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(alerts, null, 2));
}

const uid = () => Math.random().toString(36).slice(2, 10);
const RANK: Record<AlertState, number> = { firing: 0, acknowledged: 1, resolved: 2 };

export async function listAlerts(): Promise<Alert[]> {
  // Firing first, then most recent.
  return (await readAll()).sort((a, b) => RANK[a.state] - RANK[b.state] || b.at.localeCompare(a.at));
}

/** Returns `created: false` when the alert deduped into an existing one — the
 * caller uses this to notify outbound only on genuinely NEW alerts. */
export async function createAlert(input: Partial<Alert>): Promise<{ alert: Alert; created: boolean }> {
  const alerts = await readAll();
  // Dedupe: an existing non-resolved alert with the same key is updated, not doubled.
  if (input.dedupeKey) {
    const existing = alerts.find((a) => a.dedupeKey === input.dedupeKey && a.state !== "resolved");
    if (existing) {
      existing.at = new Date().toISOString();
      if (input.detail) existing.detail = input.detail;
      if (input.severity) existing.severity = input.severity;
      await writeAll(alerts);
      return { alert: existing, created: false };
    }
  }
  const alert: Alert = {
    id: uid(),
    at: new Date().toISOString(),
    severity: input.severity ?? "warning",
    title: input.title?.trim() || "Alert",
    detail: input.detail,
    state: "firing",
    jobId: input.jobId,
    dedupeKey: input.dedupeKey,
  };
  alerts.push(alert);
  await writeAll(alerts);
  return { alert, created: true };
}

export async function setAlertState(id: string, state: AlertState): Promise<Alert | null> {
  const alerts = await readAll();
  const a = alerts.find((x) => x.id === id);
  if (!a) return null;
  a.state = state;
  await writeAll(alerts);
  return a;
}
