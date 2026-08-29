import { describe, expect, it } from "vitest";
import {
  collectDescendants,
  declaredStartupProcesses,
  devServerProcess,
  devServerDisabledPath,
  parseListeningPids,
  isSupervisionPaused,
  nextCacheDir,
  pausePath,
  pidfileState,
  respawnStartupProcess,
  shouldCleanNextCache,
  type StartupProcess,
  leadingCdPath,
} from "../src/startup-supervisor.js";

const HOME = "/home/dev";
const WORK = "/home/dev/work";

function files(map: Record<string, string>) {
  return (p: string): string => {
    if (p in map) return map[p]!;
    throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
  };
}

describe("declaredStartupProcesses", () => {
  it("parses enabled entries and derives pidfile/logfile from the slug", () => {
    const read = files({
      [`${HOME}/.podbay/startup.json`]: JSON.stringify({
        commands: [
          { slug: "preview-3000", command: "node ~/preview-proxy.js" },
          { slug: "worker", command: "node worker.js", enabled: true },
        ],
      }),
    });
    const procs = declaredStartupProcesses(HOME, WORK, read);
    expect(procs.map((p) => p.slug)).toEqual(["preview-3000", "worker"]);
    expect(procs[0]).toMatchObject({
      command: "node ~/preview-proxy.js",
      cwd: WORK,
      pidfile: `${HOME}/.podbay/startup/preview-3000.pid`,
      logfile: `${HOME}/.podbay/startup/preview-3000.log`,
    });
    expect(procs[0]!.probePort).toBeUndefined();
  });

  it("skips disabled, empty, malformed, and path-hostile entries — removed entries are never resurrected", () => {
    const read = files({
      [`${HOME}/.podbay/startup.json`]: JSON.stringify({
        commands: [
          { slug: "off", command: "sleep 1", enabled: false },
          { slug: "empty", command: "" },
          { slug: "../escape", command: "evil" },
          { command: "no-slug" },
          "not-an-object",
          { slug: "ok", command: "sleep 1" },
        ],
      }),
    });
    expect(declaredStartupProcesses(HOME, WORK, read).map((p) => p.slug)).toEqual(["ok"]);
  });

  it("returns [] when the file is absent or invalid JSON", () => {
    expect(declaredStartupProcesses(HOME, WORK, files({}))).toEqual([]);
    expect(
      declaredStartupProcesses(HOME, WORK, files({ [`${HOME}/.podbay/startup.json`]: "not json" })),
    ).toEqual([]);
  });

  it("carries a valid declared port as probePort, ignores an invalid one", () => {
    const read = files({
      [`${HOME}/.podbay/startup.json`]: JSON.stringify({
        commands: [
          { slug: "ops", command: "ops.sh run", port: 3000 },
          { slug: "bad", command: "x.sh", port: 70000 }, // out of range → ignored
          { slug: "str", command: "y.sh", port: "3000" }, // wrong type → ignored
        ],
      }),
    });
    const procs = declaredStartupProcesses(HOME, WORK, read);
    expect(procs.find((p) => p.slug === "ops")!.probePort).toBe(3000);
    expect(procs.find((p) => p.slug === "bad")!.probePort).toBeUndefined();
    expect(procs.find((p) => p.slug === "str")!.probePort).toBeUndefined();
  });
});

describe("collectDescendants — the process-tree reaper for a race-free restart", () => {
  // A tree where the port-binding LEAF (400) is a grandchild that escaped the tracked pid's group —
  // the exact shape a group-kill misses (afisha-crawler: wrapper 100 → node 200 → next-server 400).
  const tree: Record<number, number[]> = { 100: [200, 300], 200: [400], 300: [], 400: [] };
  const children = (pid: number) => tree[pid] ?? [];

  it("returns every descendant, excluding the root", () => {
    expect(collectDescendants(100, children).sort((a, b) => a - b)).toEqual([200, 300, 400]);
  });

  it("reaches the deep grandchild that binds the port", () => {
    expect(collectDescendants(100, children)).toContain(400);
  });

  it("returns [] for a leaf with no children", () => {
    expect(collectDescendants(400, children)).toEqual([]);
  });

  it("is cycle-safe — a malformed ppid loop can't hang it", () => {
    const loop: Record<number, number[]> = { 1: [2], 2: [3], 3: [1] };
    expect(collectDescendants(1, (p) => loop[p] ?? []).sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it("ignores pid 0/1 and non-finite children", () => {
    expect(collectDescendants(10, (p) => (p === 10 ? [0, 1, NaN, 42] : []))).toEqual([42]);
  });
});

describe("parseListeningPids — the port-anchored reaper's ss parser", () => {
  it("extracts every listening pid, deduped, skipping pid<=1", () => {
    const ss = [
      'LISTEN 0 511 *:3000 *:* users:(("node",pid=2251,fd=20),("node",pid=2275,fd=21))',
      'LISTEN 0 511 [::]:3000 [::]:* users:(("node",pid=2251,fd=22))',
    ].join("\n");
    expect(parseListeningPids(ss).sort((a, b) => a - b)).toEqual([2251, 2275]);
  });

  it("returns [] for empty / pid-less output", () => {
    expect(parseListeningPids("")).toEqual([]);
    expect(parseListeningPids("LISTEN 0 511 *:3000 *:*")).toEqual([]);
  });
});

describe("devServerProcess", () => {
  it("supervises the dev server only when the workspace declares a dev script (init.sh's own guard)", () => {
    const withDev = files({ [`${WORK}/package.json`]: JSON.stringify({ scripts: { dev: "next dev" } }) });
    const p = devServerProcess(HOME, WORK, withDev);
    expect(p).toMatchObject({
      slug: "dev-server",
      pidfile: `${HOME}/.podbay-dev.pid`,
      probePort: 3000,
    });
    const noDev = files({ [`${WORK}/package.json`]: JSON.stringify({ scripts: {} }) });
    expect(devServerProcess(HOME, WORK, noDev, () => false)).toBeNull();
    expect(devServerProcess(HOME, WORK, files({}), () => false)).toBeNull();
  });

  it("is NOT supervised when the durable disable flag is present, even with a dev script", () => {
    const withDev = files({ [`${WORK}/package.json`]: JSON.stringify({ scripts: { dev: "next dev" } }) });
    const disabled = (p: string): boolean => p === devServerDisabledPath(HOME);
    // Flag present → null (the pod serves its own :3000; no auto pnpm dev, no .next clobber).
    expect(devServerProcess(HOME, WORK, withDev, disabled)).toBeNull();
    // Flag absent → supervised as normal.
    expect(devServerProcess(HOME, WORK, withDev, () => false)).toMatchObject({ slug: "dev-server" });
  });

  it("keys the disable flag under the persistent ~/.podbay dir", () => {
    expect(devServerDisabledPath(HOME)).toBe(`${HOME}/.podbay/dev-server-disabled`);
  });
});

describe("isSupervisionPaused — the intentional-stop truce", () => {
  const NOW = 1_800_000_000_000;
  const pf = pausePath("dev-server");

  it("pauses while the sentinel's expiry is in the future, and stops pausing once it passes", () => {
    const read = files({ [pf]: String(NOW + 30_000) });
    expect(isSupervisionPaused(pf, NOW, read)).toBe(true);
    expect(isSupervisionPaused(pf, NOW + 30_001, read)).toBe(false); // expired → recovery resumes
  });

  it("is NOT paused when the sentinel is absent or garbled (fail safe — never disable recovery forever)", () => {
    expect(isSupervisionPaused(pf, NOW, files({}))).toBe(false);
    expect(isSupervisionPaused(pf, NOW, files({ [pf]: "not-a-number" }))).toBe(false);
  });

  it("pausePath is under the persistent .podbay dir, keyed by slug", () => {
    expect(pausePath("dev-server")).toBe("/home/dev/.podbay/supervise-pause/dev-server");
  });
});

describe("shouldCleanNextCache — corrupted-.next recovery", () => {
  const dev = devServerProcess(HOME, WORK, files({ [`${WORK}/package.json`]: JSON.stringify({ scripts: { dev: "next dev" } }) }))!;
  const worker: StartupProcess = { slug: "worker", command: "node w.js", cwd: WORK, pidfile: "/p/w.pid", logfile: "/p/w.log" };

  it("wipes .next only for the dev server, and only after a respawn came up but never served", () => {
    expect(shouldCleanNextCache(dev, 0)).toBe(false); // first failure: likely a code error, not the cache
    expect(shouldCleanNextCache(dev, 1)).toBe(true); // a failed-to-serve respawn → suspect corruption
    expect(shouldCleanNextCache(worker, 5)).toBe(false); // non-dev process has no build cache to wipe
  });

  it("points at the workspace's .next", () => {
    expect(nextCacheDir(WORK)).toBe(`${WORK}/.next`);
  });
});

describe("pidfileState", () => {
  const alive = (pid: number) => {
    if (pid !== 4242) throw new Error("ESRCH");
  };

  it("distinguishes alive / dead / never-ran — never-ran means boot owns the first launch", () => {
    const read = files({ "/p/alive.pid": "4242\n", "/p/dead.pid": "31337\n" });
    expect(pidfileState("/p/alive.pid", read, alive)).toBe("alive");
    expect(pidfileState("/p/dead.pid", read, alive)).toBe("dead");
    expect(pidfileState("/p/none.pid", read, alive)).toBe("never-ran");
  });

  it("treats a corrupt pidfile as dead (it ran; we lost the pid)", () => {
    const read = files({ "/p/garbage.pid": "not-a-pid", "/p/one.pid": "1" });
    expect(pidfileState("/p/garbage.pid", read, alive)).toBe("dead");
    // pid 1 is init — a pidfile can never legitimately point there.
    expect(pidfileState("/p/one.pid", read, alive)).toBe("dead");
  });
});

describe("respawnStartupProcess", () => {
  const proc: StartupProcess = {
    slug: "worker",
    command: "node worker.js",
    cwd: WORK,
    pidfile: "/p/worker.pid",
    logfile: "/p/worker.log",
  };

  it("relaunches init.sh-style — bash -lc as dev, detached, log appended, new pid recorded", () => {
    const calls: { cmd?: unknown; args?: unknown; opts?: Record<string, unknown> } = {};
    const written: Record<string, number> = {};
    let unrefd = false;
    const pid = respawnStartupProcess(proc, {
      uid: 1000,
      gid: 1000,
      home: HOME,
      spawnFn: ((cmd: unknown, args: unknown, opts: Record<string, unknown>) => {
        Object.assign(calls, { cmd, args, opts });
        return { pid: 555, unref: () => (unrefd = true) };
      }) as never,
      openLog: () => 7,
      writePidfile: (f, p) => (written[f] = p),
    });
    expect(pid).toBe(555);
    expect(calls.cmd).toBe("bash");
    expect(calls.args).toEqual(["-lc", "node worker.js"]);
    expect(calls.opts).toMatchObject({ cwd: WORK, detached: true, uid: 1000, gid: 1000 });
    expect((calls.opts!.env as Record<string, string>).HOME).toBe(HOME);
    expect(calls.opts!.stdio).toEqual(["ignore", 7, 7]);
    expect(written["/p/worker.pid"]).toBe(555);
    expect(unrefd).toBe(true);
  });

  it("does not write a pidfile when spawn yields no pid", () => {
    const written: Record<string, number> = {};
    const pid = respawnStartupProcess(proc, {
      home: HOME,
      spawnFn: (() => ({ pid: undefined, unref: () => undefined })) as never,
      openLog: () => 7,
      writePidfile: (f, p) => (written[f] = p),
    });
    expect(pid).toBe(0);
    expect(Object.keys(written)).toEqual([]);
  });
});

describe("leadingCdPath", () => {
  // Startup commands are shell strings; the common shape is `cd <dir> && <run>`. If that directory
  // has been deleted the command can never succeed, and saying so turns an unactionable "keeps
  // failing" into a one-line fix. Wrong answers are worse than none, hence the refusals below.
  it("finds the directory a command cds into", () => {
    expect(
      leadingCdPath("cd /home/dev/worktrees/dashboard-concepts && pnpm -F @podbay/web exec next dev"),
    ).toBe("/home/dev/worktrees/dashboard-concepts");
  });

  it("handles quoting and a semicolon separator", () => {
    expect(leadingCdPath('cd "/home/dev/my dir" && ls')).toBe("/home/dev/my dir");
    expect(leadingCdPath("cd '/home/dev/other' ; ls")).toBe("/home/dev/other");
  });

  it("returns null when the command does not start with cd", () => {
    expect(leadingCdPath("pnpm dev")).toBeNull();
    expect(leadingCdPath("npx serve && cd /tmp")).toBeNull();
  });

  it("REFUSES to guess an unexpanded path — a wrong 'folder is missing' is worse than silence", () => {
    expect(leadingCdPath("cd $HOME/work && pnpm dev")).toBeNull();
    expect(leadingCdPath("cd ~/work && pnpm dev")).toBeNull();
    expect(leadingCdPath("cd /home/dev/*/build && ls")).toBeNull();
  });

  it("refuses a relative path, which is meaningless without knowing the cwd", () => {
    expect(leadingCdPath("cd work && pnpm dev")).toBeNull();
    expect(leadingCdPath("cd ../sibling && pnpm dev")).toBeNull();
  });

  it("requires a separator, so a bare cd is not treated as a prefix", () => {
    expect(leadingCdPath("cd /home/dev/work")).toBeNull();
  });
});
