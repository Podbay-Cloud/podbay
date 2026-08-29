/**
 * Central react-query key factory (web-data-layer-react-query). One place for every query key so
 * invalidation and cache lookups can't drift. Keys are arrays: a stable head + the params that scope
 * the data. See `.claude/rules/ui-patterns.md`.
 */
export const qk = {
  /** Per-agent live state for a pod's cockpit (Control tab). */
  agents: (slug: string) => ["pod", slug, "agents"] as const,
  /** Legacy codex-RC probe (old images with no per-agent data). */
  codexRc: (slug: string) => ["pod", slug, "codex-rc"] as const,
  /** Paired Codex devices. */
  codexDevices: (slug: string) => ["pod", slug, "codex-devices"] as const,
  /** Owner-wide live signals (dashboard pod cards + cockpit header). */
  liveSignals: () => ["owner", "live-signals"] as const,
  /** Live metrics for a pod's Stats tab, per time window. */
  metrics: (slug: string, windowMs: number) => ["pod", slug, "metrics", windowMs] as const,
  /** A pod's secrets + secret-requests. */
  secrets: (slug: string) => ["pod", slug, "secrets"] as const,
  /** Doctor / health checks for a pod (Admin). */
  doctor: (slug: string) => ["pod", slug, "doctor"] as const,
  /** GitHub connection status + repo list. */
  github: (slug: string) => ["pod", slug, "github"] as const,
  /** Image-update / T3-enable progress (gated polls). */
  updateProgress: (slug: string) => ["pod", slug, "update-progress"] as const,
  t3Progress: (slug: string) => ["pod", slug, "t3-progress"] as const,
} as const;
