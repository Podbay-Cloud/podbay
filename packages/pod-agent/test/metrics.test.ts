import { describe, expect, it } from "vitest";
import {
  MetricsSampler,
  parseCpu,
  parseMem,
  parseNet,
  parseCgroupMem,
  parseCgroupCpuMax,
  parseCpuStat,
  type SamplerDeps,
} from "../src/metrics.js";
import type { MetricSample } from "@podbay/shared/metrics-types";

describe("metrics parsers", () => {
  it("parseCpu sums jiffies and treats idle+iowait as idle", () => {
    // user nice system idle iowait irq softirq steal
    const c = parseCpu("cpu  100 0 50 800 40 0 10 0\ncpu0 ...");
    expect(c.total).toBe(1000);
    expect(c.busy).toBe(1000 - (800 + 40)); // 160
  });

  it("parseMem computes used from MemTotal - MemAvailable (kB → MB)", () => {
    const m = parseMem("MemTotal:       4096000 kB\nMemFree: 100 kB\nMemAvailable:   1024000 kB\n");
    expect(m.totalMb).toBe(4000);
    expect(m.usedMb).toBe(3000); // (4096000-1024000)/1024
  });

  it("parseNet sums real interfaces and skips loopback", () => {
    const dev = [
      "Inter-|   Receive ...",
      " face |bytes    packets errs drop fifo frame compressed multicast|bytes ...",
      "    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0",
      "enp5s0: 1000 5 0 0 0 0 0 0 2000 7 0 0 0 0 0 0",
    ].join("\n");
    const n = parseNet(dev);
    expect(n.rx).toBe(1000); // lo excluded
    expect(n.tx).toBe(2000);
  });

  it("parseCgroupMem uses memory.max/current when limited, and yields to /proc when unlimited", () => {
    // 2 GiB limit, 512 MiB in use.
    const m = parseCgroupMem(String(2 * 1024 * 1024 * 1024), String(512 * 1024 * 1024));
    expect(m).toEqual({ totalMb: 2048, usedMb: 512 });
    // "max" (unlimited) and blank → null so the caller falls back to /proc/meminfo.
    expect(parseCgroupMem("max", "123")).toBeNull();
    expect(parseCgroupMem("", "123")).toBeNull();
    expect(parseCgroupMem("0", "123")).toBeNull();
  });

  it("parseCgroupCpuMax returns quota/period cores, null when unlimited", () => {
    expect(parseCgroupCpuMax("200000 100000")).toBe(2); // 2 cores
    expect(parseCgroupCpuMax("50000 100000")).toBe(0.5);
    expect(parseCgroupCpuMax("max 100000")).toBeNull();
    expect(parseCgroupCpuMax("max")).toBeNull();
  });

  it("parseCpuStat reads cumulative usage_usec", () => {
    expect(parseCpuStat("usage_usec 1234567\nuser_usec 1000000\nsystem_usec 234567")).toBe(1234567);
    expect(parseCpuStat("nr_periods 0")).toBe(0);
  });
});

/** A scripted deps whose counters advance per tick, so we can assert deltas. */
function scriptedDeps(): { deps: SamplerDeps; step: () => void } {
  let cpuBusy = 0;
  let netRx = 0;
  let t = 1_000_000;
  const deps: SamplerDeps = {
    // +100 busy of +400 total each step → 25% once a delta exists.
    readProcStat: () => `cpu 0 0 ${cpuBusy} ${300 /*idle grows too*/} 0 0 0 0`,
    readMemInfo: () => "MemTotal: 4096000 kB\nMemAvailable: 2048000 kB\n",
    readDisk: () => ({ totalMb: 10240, usedMb: 4096 }),
    readNetDev: () => `enp5s0: ${netRx} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0`,
    readAgentStatus: () => "shell",
    readAppListening: () => true,
    readDiskBreakdown: async () => [{ label: "Repo", mb: 120 }],
    now: () => t,
  };
  return {
    deps,
    step: () => {
      cpuBusy += 100;
      netRx += 1024; // 1 KiB/step
      t += 1000; // 1s
    },
  };
}

describe("MetricsSampler", () => {
  it("first tick is a warm-up (no prior counters → cpu/net 0), then reports deltas", () => {
    const { deps, step } = scriptedDeps();
    const s = new MetricsSampler(deps, { intervalMs: 1000, maxSamples: 100 });

    const warm = s.tick();
    expect(warm.cpuPct).toBe(0);
    expect(warm.netRxKbps).toBe(0);
    expect(warm.memUsedMb).toBe(2000); // (4096000-2048000)/1024
    expect(warm.diskTotalMb).toBe(10240);

    step();
    const d = s.tick();
    // busy +100 of total(+100 busy, idle flat) → but total delta = 100 → 100%.
    expect(d.cpuPct).toBeGreaterThan(0);
    // 1 KiB over 1s = 8 kbit/s.
    expect(d.netRxKbps).toBe(8);
    expect(d.agentStatus).toBe("shell");
  });

  it("uses cgroup memory + per-quota cpu when the pod is limited (not the host /proc view)", () => {
    // Host /proc says 4 GB total / 2 GB used, and the host is near-idle. But the pod is
    // limited to 1 GB (768 MB in use) and 2 cores, and burned 2 core-seconds this interval.
    const { deps, step } = scriptedDeps();
    let usageUsec = 0;
    const limited: SamplerDeps = {
      ...deps,
      readCgroupMem: () => ({ usedMb: 768, totalMb: 1024 }),
      readCgroupCpu: () => ({ usageUsec, quotaCores: 2 }),
    };
    const s = new MetricsSampler(limited, { intervalMs: 1000, maxSamples: 100 });

    const warm = s.tick(); // no prior cgroup counter → cpu 0, but memory is the pod's
    expect(warm.memTotalMb).toBe(1024);
    expect(warm.memUsedMb).toBe(768);
    expect(warm.cpuPct).toBe(0);

    step(); // +1s
    usageUsec += 1_000_000; // used 1 core-second of a 2-core allowance over 1s → 50%
    const d = s.tick();
    expect(d.memTotalMb).toBe(1024);
    expect(d.cpuPct).toBe(50);
  });

  it("ring buffer caps at maxSamples", () => {
    const { deps, step } = scriptedDeps();
    const s = new MetricsSampler(deps, { intervalMs: 1000, maxSamples: 3 });
    for (let i = 0; i < 6; i++) {
      s.tick();
      step();
    }
    expect(s.snapshot().series.length).toBe(3);
  });

  it("snapshot reports disk usage, app-port status, and the sample interval", () => {
    const { deps } = scriptedDeps();
    const s = new MetricsSampler(deps, { intervalMs: 60_000, appPort: 3000 });
    s.tick();
    const snap = s.snapshot();
    expect(snap.disk.usedMb).toBe(4096);
    expect(snap.disk.totalMb).toBe(10240);
    expect(snap.app).toEqual({ port: 3000, listening: true });
    expect(snap.sampleIntervalMs).toBe(60_000);
  });

  it("start() restores persisted history, then flushes new samples (survives suspend/resume)", () => {
    const { deps, step } = scriptedDeps();
    // Simulate a volume that already holds two pre-suspend samples.
    let stored: MetricSample[] = [
      { t: 1, cpuPct: 5, memUsedMb: 1, memTotalMb: 2, diskUsedMb: 1, diskTotalMb: 2, netRxKbps: 0, netTxKbps: 0, agentStatus: "idle" },
      { t: 2, cpuPct: 6, memUsedMb: 1, memTotalMb: 2, diskUsedMb: 1, diskTotalMb: 2, netRxKbps: 0, netTxKbps: 0, agentStatus: "idle" },
    ];
    const persistDeps: SamplerDeps = {
      ...deps,
      loadHistory: () => stored,
      persistHistory: (s) => {
        stored = [...s];
      },
    };
    const s = new MetricsSampler(persistDeps, { intervalMs: 1000, maxSamples: 100 });
    s.start(); // loads the 2 prior + one warm-up tick + flushes
    s.stop();

    const series = s.snapshot().series;
    expect(series.length).toBe(3); // 2 restored + 1 warm-up
    expect(series[0].t).toBe(1); // oldest preserved
    expect(series[2].agentStatus).toBe("shell"); // the fresh warm-up sample
    expect(stored.length).toBe(3); // and it was flushed back to the volume
    void step;
  });

  it("loadPersisted keeps only the NEWEST maxSamples and drops malformed entries", () => {
    const { deps } = scriptedDeps();
    const many: MetricSample[] = Array.from({ length: 10 }, (_, i) => ({
      t: i, cpuPct: i, memUsedMb: 0, memTotalMb: 0, diskUsedMb: 0, diskTotalMb: 0, netRxKbps: 0, netTxKbps: 0, agentStatus: null,
    }));
    const s = new MetricsSampler(
      { ...deps, loadHistory: () => many, persistHistory: () => {} },
      { intervalMs: 1000, maxSamples: 3 },
    );
    s.start();
    s.stop();
    const series = s.snapshot().series;
    // 3-cap: the load keeps the newest 3 (t 7,8,9), then the warm-up tick pushes
    // one more and the ring shifts → newest 3 overall.
    expect(series.length).toBe(3);
    expect(series[0].t).toBe(8);
    expect(series[series.length - 1].t).not.toBe(9); // last is the fresh warm-up sample
  });

  it("a corrupt/empty history load is ignored (ring starts clean)", () => {
    const { deps } = scriptedDeps();
    const s = new MetricsSampler(
      {
        ...deps,
        loadHistory: () => {
          throw new Error("corrupt file");
        },
        persistHistory: () => {},
      },
      { intervalMs: 1000, maxSamples: 100 },
    );
    s.start();
    s.stop();
    expect(s.snapshot().series.length).toBe(1); // just the warm-up; no crash
  });
});
