import "server-only";

import { classifyEvent, SEVERITY_RANK, type Severity } from "@podbay/control-plane";
import { requireAdmin } from "./access";
import { getPodService } from "./pod-service";

/**
 * Fleet incidents for the backoffice (pod-observability §6): every recent unplanned
 * warn/critical event across ALL pods, classified server-side (classifyEvent lives in
 * the server-only control-plane), worst-first then newest. Drives /admin/incidents so
 * an operator sees the whole fleet's trouble in one place and drills into a pod.
 */
export interface DoctorSnapshot {
  checked: number;
  issues: { id: string; severity: string; title: string }[];
}

export interface FleetIncident {
  podId: string;
  podName: string | null;
  ownerId: string;
  type: string;
  severity: Severity;
  title: string;
  at: string;
  /** A read-only doctor snapshot captured at incident time (§2), when present. */
  doctor?: DoctorSnapshot;
}

/** Only surface trouble from the recent past — an incident from three weeks ago is
 * history, not something an operator needs to act on now. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function getFleetIncidents(limit = 200): Promise<FleetIncident[]> {
  await requireAdmin();
  const svc = getPodService();
  const [events, pods] = await Promise.all([svc.listAllEvents(), svc.listAllPods()]);
  const nameById = new Map(pods.map((p) => [p.id, p.name] as const));
  const now = Date.now();

  return events
    .map((e) => ({ e, inc: classifyEvent(e.type, e.meta) }))
    .filter(
      ({ e, inc }) =>
        inc.unplanned &&
        SEVERITY_RANK[inc.severity] >= SEVERITY_RANK.warn &&
        now - new Date(e.at).getTime() < WINDOW_MS,
    )
    .map(({ e, inc }) => {
      const d = (e.meta as { doctor?: DoctorSnapshot } | null)?.doctor;
      return {
        podId: e.podId,
        podName: nameById.get(e.podId) ?? null,
        ownerId: e.ownerId,
        type: e.type,
        severity: inc.severity,
        title: inc.title,
        at: e.at,
        doctor: d && Array.isArray(d.issues) ? d : undefined,
      };
    })
    // Worst-first (critical over warn), then most recent — the operator's reading order.
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        new Date(b.at).getTime() - new Date(a.at).getTime(),
    )
    .slice(0, limit);
}
