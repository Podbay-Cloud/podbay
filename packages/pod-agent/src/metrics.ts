import { readFileSync, writeFileSync, renameSync, statfsSync } from "node:fs";
import { execFile } from "node:child_process";
import type {
  MetricSample,
  DiskBreakdownEntry,
  MetricsSnapshot,
} from "@podbay/shared/metrics-types";
import { compact, windowed } from "./rollup.js";

export type { MetricSample, DiskBreakdownEntry, MetricsSnapshot };

/**
 * In-pod resource sampler for the Stats tab (docs/plans/stats-redesign-plan.md P1).
 * Reads /proc + statfs + `du`, keeps a rolling ring buffer, and serves a snapshot
 * on GET /metrics. The ring is PERSISTED to the pod's /home/dev block volume, so
 * history survives suspend/resume AND an image-update recreate (both kill the
 * agent process) instead of restarting from zero — the volume outlives the
 * machine. Loaded on start, flushed after each tick; every write is best-effort
 * and atomic (temp+rename) so a crash mid-write can't corrupt the file. Samples
 * carry a timestamp, so a suspended stretch reads as a real gap, not fake zeros.
 * CPU% and network rate are DELTAS between ticks, so the sampler holds the
 * previous counters.
 *
 * Every low-level read/write is injectable so the delta/fold logic is
 * unit-testable without a real /proc or filesystem.
 */

interface CpuCounters {
  busy: number;
  total: number;
}
interface NetCounters {
  rx: number;
  tx: number;
  t: number;
}

export interface SamplerDeps {
  /** Raw /proc/stat contents. */
  readProcStat: () => string;
  /** Raw /proc/meminfo contents. */
  readMemInfo: () => string;
  /** cgroup v2 memory, when the pod runs under one (self-host limited container): the parsed
   * `{ usedMb, totalMb }` from memory.current/memory.max, or null when unlimited / not a cgroup-v2
   * container (then /proc/meminfo answers). Optional — omitted off-Linux and in tests. */
  readCgroupMem?: () => { usedMb: number; totalMb: number } | null;
  /** cgroup v2 CPU, when the pod is CPU-limited: `{ usageUsec, quotaCores }` from cpu.stat/cpu.max,
   * or null when unlimited / absent (then the host /proc/stat delta answers). Optional. */
  readCgroupCpu?: () => { usageUsec: number; quotaCores: number } | null;
  /** { totalMb, usedMb } for the home volume. */
  readDisk: () => { totalMb: number; usedMb: number };
  /** Raw /proc/net/dev contents. */
  readNetDev: () => string;
  /** Claude's status (busy|shell|idle|waiting) or null. */
  readAgentStatus: () => string | null;
  /** Whether the app's preview port is in LISTEN. */
  readAppListening: (port: number) => boolean;
  /** du of the home volume's notable dirs. */
  readDiskBreakdown: () => Promise<DiskBreakdownEntry[]>;
  now: () => number;
  /** Load the persisted sample history (on the /home/dev volume) so it survives a
   * suspend/resume or recreate. Optional — omitted in tests / off-Linux; missing
   * or corrupt file returns []. */
  loadHistory?: () => MetricSample[];
  /** Persist the current ring atomically. Optional; best-effort — a failed write
   * loses a flush, never the agent. */
  persistHistory?: (samples: MetricSample[]) => void;
}

const MB = 1024 * 1024;

/** Call an optional dep reader, swallowing any throw (a missing cgroup file must never crash a
 * tick — we just fall back to /proc). Returns null when the reader is absent or throws. */
function safeRead<T>(fn?: () => T | null): T | null {
  if (!fn) return null;
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Parse the aggregate `cpu ...` line of /proc/stat into busy/total jiffies. */
export function parseCpu(procStat: string): CpuCounters {
  const line = procStat.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return { busy: 0, total: 0 };
  const n = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((x) => Number(x) || 0);
  // user nice system idle iowait irq softirq steal guest guest_nice
  const idle = (n[3] ?? 0) + (n[4] ?? 0); // idle + iowait
  const total = n.reduce((a, b) => a + b, 0);
  return { busy: total - idle, total };
}

/** MemTotal/MemAvailable (kB) → used/total MB. */
export function parseMem(memInfo: string): { usedMb: number; totalMb: number } {
  const kv = (k: string): number => {
    const m = memInfo.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"));
    return m ? Number(m[1]) : 0;
  };
  const totalKb = kv("MemTotal");
  const availKb = kv("MemAvailable");
  return { usedMb: Math.max(0, Math.round((totalKb - availKb) / 1024)), totalMb: Math.round(totalKb / 1024) };
}

/**
 * cgroup v2 memory (self-host-pod-sizing): a Docker container without LXCFS sees the HOST's
 * /proc/meminfo, so a limited pod would report the whole host's RAM. When `memory.max` is a real
 * byte count (not "max"), the pod IS limited — report usage against that limit instead. `max` ⇒
 * unlimited ⇒ null, and the caller falls back to /proc (an unlimited pod genuinely shares host RAM).
 */
export function parseCgroupMem(
  maxRaw: string,
  currentRaw: string,
): { usedMb: number; totalMb: number } | null {
  const max = maxRaw.trim();
  if (max === "" || max === "max") return null; // unlimited → let /proc answer
  const maxBytes = Number(max);
  const curBytes = Number(currentRaw.trim());
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return null;
  return {
    usedMb: Math.max(0, Math.round((Number.isFinite(curBytes) ? curBytes : 0) / MB)),
    totalMb: Math.round(maxBytes / MB),
  };
}

/** cgroup v2 `cpu.max` → the pod's core allowance ("<quota> <period>" µs; "max" ⇒ unlimited ⇒ null). */
export function parseCgroupCpuMax(raw: string): number | null {
  const [quota, period] = raw.trim().split(/\s+/);
  if (!quota || quota === "max") return null;
  const q = Number(quota);
  const p = Number(period) || 100_000;
  return Number.isFinite(q) && q > 0 && p > 0 ? q / p : null;
}

/** cgroup v2 `cpu.stat` → cumulative CPU time the pod has used, in microseconds. */
export function parseCpuStat(raw: string): number {
  const m = raw.match(/^usage_usec\s+(\d+)/m);
  return m ? Number(m[1]) : 0;
}

/** Sum rx/tx bytes across real interfaces (skip loopback) from /proc/net/dev. */
export function parseNet(netDev: string): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const line of netDev.split("\n")) {
    const m = line.match(/^\s*([\w.-]+):\s+(.*)$/);
    if (!m || m[1] === "lo") continue;
    const cols = m[2].trim().split(/\s+/).map(Number);
    rx += cols[0] || 0; // receive bytes
    tx += cols[8] || 0; // transmit bytes
  }
  return { rx, tx };
}

export class MetricsSampler {
  private readonly ring: MetricSample[] = [];
  private prevCpu: CpuCounters | null = null;
  /** Previous cgroup CPU usage (µs) + wall-clock, for the per-pod CPU% delta when limited. */
  private prevCgCpu: { usageUsec: number; t: number } | null = null;
  private prevNet: NetCounters | null = null;
  private breakdown: DiskBreakdownEntry[] = [];
  private lastBreakdownAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly deps: SamplerDeps,
    private readonly opts: {
      intervalMs?: number;
      maxSamples?: number;
      breakdownEveryMs?: number;
      appPort?: number | null;
    } = {},
  ) {}

  private get intervalMs(): number {
    return this.opts.intervalMs ?? 60_000;
  }
  private get maxSamples(): number {
    // Generous ceiling: the TIERS are what bound history now (compact() folds
    // anything older than 24h), and this is only a runaway guard.
    return this.opts.maxSamples ?? 6000;
  }

  /** Produce one sample from the deltas since the last tick. The FIRST tick has
   * no previous counters, so cpu/net read 0 (a warm-up sample). */
  tick(): MetricSample {
    const t = this.deps.now();
    const cpu = parseCpu(this.deps.readProcStat());
    const net = parseNet(this.deps.readNetDev());
    const disk = this.deps.readDisk();
    // Memory: prefer the pod's own cgroup limit when it's a real container limit — else /proc
    // (which, without LXCFS, is the HOST's RAM). A read that throws falls back too.
    const cgMem = safeRead(this.deps.readCgroupMem);
    const mem = cgMem ?? parseMem(this.deps.readMemInfo());

    // CPU%: when the pod is cpu-limited, measure usage against ITS quota (Δusage_usec over the
    // interval, divided by quotaCores × elapsed) so a 2-core pod on a 32-core host doesn't read
    // ~6%. Unlimited / no cgroup falls back to the host /proc/stat busy-jiffy delta.
    const cgCpu = safeRead(this.deps.readCgroupCpu);
    let cpuPct = 0;
    if (cgCpu) {
      if (this.prevCgCpu && cgCpu.usageUsec >= this.prevCgCpu.usageUsec) {
        const dtSec = (t - this.prevCgCpu.t) / 1000;
        const capacityUsec = cgCpu.quotaCores * dtSec * 1e6;
        cpuPct =
          capacityUsec > 0
            ? Math.min(100, Math.max(0, Math.round(((cgCpu.usageUsec - this.prevCgCpu.usageUsec) / capacityUsec) * 100)))
            : 0;
      }
    } else if (this.prevCpu) {
      const dTotal = cpu.total - this.prevCpu.total;
      const dBusy = cpu.busy - this.prevCpu.busy;
      cpuPct = dTotal > 0 ? Math.min(100, Math.max(0, Math.round((dBusy / dTotal) * 100))) : 0;
    }
    this.prevCpu = cpu;
    this.prevCgCpu = cgCpu ? { usageUsec: cgCpu.usageUsec, t } : null;

    let netRxKbps = 0;
    let netTxKbps = 0;
    if (this.prevNet) {
      const dt = (t - this.prevNet.t) / 1000;
      if (dt > 0) {
        netRxKbps = Math.max(0, Math.round(((net.rx - this.prevNet.rx) / dt / 1024) * 8));
        netTxKbps = Math.max(0, Math.round(((net.tx - this.prevNet.tx) / dt / 1024) * 8));
      }
    }
    this.prevNet = { ...net, t };

    const sample: MetricSample = {
      t,
      cpuPct,
      memUsedMb: mem.usedMb,
      memTotalMb: mem.totalMb,
      diskUsedMb: disk.usedMb,
      diskTotalMb: disk.totalMb,
      netRxKbps,
      netTxKbps,
      agentStatus: this.deps.readAgentStatus(),
    };
    this.ring.push(sample);
    // Fold older detail into coarser buckets so history reaches 30 days without the
    // payload growing: 1min/24h · 5min/7d · 1h/30d. Compaction is idempotent — an
    // already-folded sample lands in the same bucket — so running it every tick is
    // safe and keeps the ring at a steady ~4k samples.
    const compacted = compact(this.ring, sample.t);
    this.ring.length = 0;
    this.ring.push(...compacted);
    if (this.ring.length > this.maxSamples) this.ring.splice(0, this.ring.length - this.maxSamples);
    return sample;
  }

  /** Start sampling on a timer. Fires an immediate warm-up tick. A read that
   * fails (e.g. no /proc off-Linux, or a transient) must never crash the agent. */
  start(): void {
    if (this.timer) return;
    this.loadPersisted(); // resume the ring from the volume before the first tick
    try {
      this.tick();
    } catch {
      /* first read failed; the interval retries */
    }
    this.persist(); // flush the warm-up sample + restored history immediately
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch {
        /* a bad read must never crash the agent */
      }
      this.persist();
      void this.maybeRefreshBreakdown();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  /** Seed the ring from persisted history (once, at start). Capped to maxSamples,
   * keeping the NEWEST. Deltas (prevCpu/prevNet) are intentionally NOT restored —
   * the first post-resume tick reads a warm-up 0 rather than a bogus spike
   * computed across the suspended gap. Best-effort; a bad file is ignored. */
  private loadPersisted(): void {
    if (this.ring.length > 0) return; // never double-load
    let prior: MetricSample[] = [];
    try {
      prior = this.deps.loadHistory?.() ?? [];
    } catch {
      prior = [];
    }
    if (!Array.isArray(prior) || prior.length === 0) return;
    const trimmed = prior.slice(-this.maxSamples);
    this.ring.push(...trimmed);
  }

  /** Persist the ring to the volume. Best-effort — swallows all errors. */
  private persist(): void {
    try {
      this.deps.persistHistory?.(this.ring);
    } catch {
      /* a failed flush loses a data point, never the agent */
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async maybeRefreshBreakdown(): Promise<void> {
    const every = this.opts.breakdownEveryMs ?? 10 * 60_000;
    if (this.deps.now() - this.lastBreakdownAt < every) return;
    this.lastBreakdownAt = this.deps.now();
    try {
      this.breakdown = await this.deps.readDiskBreakdown();
    } catch {
      /* du is best-effort */
    }
  }

  /** Whether anything is serving the preview port RIGHT NOW — a cheap live probe
   * (no ring copy), for /healthz. The dashboard gates the Preview button on it. */
  appListening(): { port: number | null; listening: boolean } {
    const port = this.opts.appPort ?? null;
    return { port, listening: port != null ? this.deps.readAppListening(port) : false };
  }

  /** The full tiered history, or just the requested window (at that window's
   * resolution) when the caller asks for one. */
  snapshot(windowMs?: number): MetricsSnapshot {
    const last = this.ring[this.ring.length - 1];
    const port = this.opts.appPort ?? null;
    return {
      series: windowMs ? windowed(this.ring, windowMs, Date.now()) : [...this.ring],
      disk: {
        path: "/home/dev",
        usedMb: last?.diskUsedMb ?? 0,
        totalMb: last?.diskTotalMb ?? 0,
        breakdown: this.breakdown,
      },
      app: { port, listening: port != null ? this.deps.readAppListening(port) : false },
      sampleIntervalMs: this.intervalMs,
    };
  }
}

/** Where the persisted metric history lives — on the /home/dev block volume, so it
 * outlives the machine (suspend/resume + image-update recreate). */
export function metricsHistoryPath(homePath: string): string {
  return `${homePath}/.podbay-metrics.json`;
}

/** Default deps reading the real pod. */
export function realSamplerDeps(opts: {
  homePath: string;
  agentStatus: () => string | null;
}): SamplerDeps {
  const historyPath = metricsHistoryPath(opts.homePath);
  return {
    readProcStat: () => readFileSync("/proc/stat", "utf8"),
    readMemInfo: () => readFileSync("/proc/meminfo", "utf8"),
    readNetDev: () => readFileSync("/proc/net/dev", "utf8"),
    // cgroup v2 unified hierarchy (self-host limited containers). Absent on cgroup-v1 hosts or
    // off-Linux → return null so the sampler uses /proc. Each read is independently guarded.
    readCgroupMem: () => {
      const max = tryRead("/sys/fs/cgroup/memory.max");
      const current = tryRead("/sys/fs/cgroup/memory.current");
      if (max == null || current == null) return null;
      return parseCgroupMem(max, current);
    },
    readCgroupCpu: () => {
      const cpuMax = tryRead("/sys/fs/cgroup/cpu.max");
      if (cpuMax == null) return null;
      const quotaCores = parseCgroupCpuMax(cpuMax);
      if (quotaCores == null) return null; // unlimited → host /proc/stat answers
      const stat = tryRead("/sys/fs/cgroup/cpu.stat");
      if (stat == null) return null;
      return { usageUsec: parseCpuStat(stat), quotaCores };
    },
    readDisk: () => {
      const s = statfsSync(opts.homePath);
      const totalMb = Math.round((s.blocks * s.bsize) / MB);
      const usedMb = Math.round(((s.blocks - s.bfree) * s.bsize) / MB);
      return { totalMb, usedMb };
    },
    readAgentStatus: opts.agentStatus,
    readAppListening: (port) => {
      // A LISTEN socket shows local_address port (hex) with state 0A in
      // /proc/net/tcp{,6}. Read both; either file may be absent.
      const read = (p: string): string => {
        try {
          return readFileSync(p, "utf8");
        } catch {
          return "";
        }
      };
      const hex = port.toString(16).toUpperCase().padStart(4, "0");
      const tcp = read("/proc/net/tcp") + read("/proc/net/tcp6");
      return new RegExp(`:${hex} [0-9A-F]+:0000 0A`, "m").test(tcp);
    },
    readDiskBreakdown: () =>
      duBreakdown([
        { label: "Repo", path: `${opts.homePath}/work` },
        { label: "node_modules", path: `${opts.homePath}/work/node_modules` },
        { label: "Claude", path: `${opts.homePath}/.claude` },
      ]),
    now: () => Date.now(),
    loadHistory: () => {
      let raw: string;
      try {
        raw = readFileSync(historyPath, "utf8");
      } catch {
        return []; // no history yet — first boot of this volume
      }
      try {
        const parsed = JSON.parse(raw);
        // Tolerate both a bare array and a {samples:[...]} envelope; keep only
        // well-formed samples (a partial/old-schema file must not poison the ring).
        const arr = Array.isArray(parsed) ? parsed : parsed?.samples;
        if (!Array.isArray(arr)) return [];
        return arr.filter(
          (s): s is MetricSample => s && typeof s.t === "number" && typeof s.cpuPct === "number",
        );
      } catch {
        return []; // corrupt (e.g. torn write on an old build) — start clean
      }
    },
    persistHistory: (samples) => {
      // Atomic: write a temp file then rename over the target, so a crash mid-write
      // leaves the previous good file intact (rename is atomic within a filesystem).
      const tmp = `${historyPath}.tmp`;
      writeFileSync(tmp, JSON.stringify({ v: 1, samples }), "utf8");
      renameSync(tmp, historyPath);
    },
  };
}

/** Read a file, or null if it's absent/unreadable (e.g. a cgroup file that doesn't exist here). */
function tryRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** `du -sm` each path (best-effort; missing dirs read 0). */
function duBreakdown(dirs: { label: string; path: string }[]): Promise<DiskBreakdownEntry[]> {
  return Promise.all(
    dirs.map(
      (d) =>
        new Promise<DiskBreakdownEntry>((resolve) => {
          execFile("du", ["-sm", d.path], { timeout: 15_000 }, (err, stdout) => {
            const mb = err ? 0 : Number(stdout.trim().split(/\s+/)[0]) || 0;
            resolve({ label: d.label, mb });
          });
        }),
    ),
  );
}
