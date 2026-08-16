/**
 * Pod resource-metrics shapes (docs/plans/stats-redesign-plan.md). Produced by the
 * pod-agent's sampler, consumed by the control plane, gateway and web Stats tab.
 * Pure types — no runtime — so every layer can share them without depending on
 * the pod-agent package.
 */

export interface MetricSample {
  /** epoch ms */
  t: number;
  /** busy CPU across all vCPUs, 0–100 */
  cpuPct: number;
  memUsedMb: number;
  memTotalMb: number;
  diskUsedMb: number;
  diskTotalMb: number;
  netRxKbps: number;
  netTxKbps: number;
  /** Claude's own state: busy|shell|idle|waiting (null = unknown). */
  agentStatus: string | null;
}

export interface DiskBreakdownEntry {
  label: string;
  mb: number;
}

export interface MetricsSnapshot {
  series: MetricSample[];
  disk: { path: string; usedMb: number; totalMb: number; breakdown: DiskBreakdownEntry[] };
  app: { port: number | null; listening: boolean };
  sampleIntervalMs: number;
}

/** A pod as it sits on a box (for the fit visual + overcommit view). */
export interface BoxPod {
  id: string;
  name: string | null;
  size: string;
  slots: number;
  status: string;
  /** Live RAM the pod is actually using on the host, or null if unreadable. */
  ramUsedMb: number | null;
}

/** Host-level stats for one self-hosted box (docs/plans/box-observability-plan.md).
 * Sourced from the Incus API; `reachable:false` means the numbers are unknown. */
export interface BoxStats {
  name: string;
  region: string;
  reachable: boolean;
  cpuCores: number;
  ramUsedMb: number;
  ramTotalMb: number;
  diskUsedMb: number;
  diskTotalMb: number;
  pods: BoxPod[];
}
