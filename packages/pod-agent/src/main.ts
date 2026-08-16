import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, renameSync, chownSync } from "node:fs";
import path from "node:path";
import { createLogger } from "@podbay/shared/log";
import { AgentServer } from "./server.js";
import { startScheduler } from "./scheduler.js";
import {
  bootCommandForAgent,
  kickoffCommandForAgent,
  credentialsPathForAgent,
  sanitizeSessionName,
  KICKOFF_PATH,
  KICKOFF_TRIGGER,
  RESUME_TRIGGER,
  DEFAULT_PERMISSION_MODE,
  type AgentAuth,
} from "./boot.js";
import { parseOomKills } from "./oom.js";
import { attributeRestartToOom, composeResumeNudge } from "./incident-nudge.js";

const log = createLogger("pod-agent");

/**
 * The resume nudge, enriched with a Podbay system notice when THIS restart was caused
 * by an agent OOM (design.md §3 — the primary owner channel). Best-effort: any failure
 * to read dmesg/uptime/spec falls back to the plain nudge, never blocking boot.
 */
function resumeNudge(): string {
  try {
    const dmesg = execFileSync("dmesg", { encoding: "utf8", maxBuffer: 8_000_000 });
    const uptimeSec = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) || 0;
    const attribution = attributeRestartToOom(parseOomKills(dmesg), uptimeSec, (c) =>
      /claude|codex/i.test(c),
    );
    if (attribution) {
      log.info("resume_oom_attributed", { victim: attribution.victim, loop: attribution.loop });
    }
    const cockpitUrl = readSpec().cockpitUrl;
    return composeResumeNudge(RESUME_TRIGGER, attribution, typeof cockpitUrl === "string" ? cockpitUrl : null);
  } catch {
    return RESUME_TRIGGER;
  }
}

/**
 * Pod entrypoint: run first-boot seeding (podbay-init), then serve the terminal.
 */
async function main(): Promise<void> {
  // First-boot seeding from sandbox-provider (idempotent via its marker).
  if (existsSync("/usr/local/bin/podbay-init")) {
    try {
      // PID 1 inherits no PATH, so pass a known-good one — otherwise init's
      // `python3`/`iptables` steps silently fail to resolve. (init.sh also sets
      // PATH itself; this is belt-and-suspenders for anything it execs.)
      execFileSync("/usr/local/bin/podbay-init", {
        stdio: "inherit",
        env: { ...process.env, PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
      });
    } catch (e) {
      log.error("init_failed", { err: e });
    }
  }

  const agent = readAgent();
  const mode = readPermissionMode();
  const agentAuth = readAgentAuth();
  const sessionName = readSessionName();
  // The pod's unprivileged user owns the home volume. pod-agent runs as root
  // only to seed (podbay-init above); the shell must run as `dev` so ~/.claude,
  // ~/work, and login state land on the persistent /home/dev volume.
  const home = "/home/dev";
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const server = new AgentServer({
    sessionName: "main",
    cwd: path.join(home, "work"),
    env: { HOME: home, USER: "dev" },
    uid: isRoot ? 1000 : undefined,
    gid: isRoot ? 1000 : undefined,
    bootCommand: bootCommandForAgent(agent, mode, agentAuth),
    credential: { agent, path: credentialsPathForAgent(agent) },
    // Adding an agent to a LIVE pod (slice 3): main.ts owns the pod-spec, so it
    // builds the command. The ADDED agent joins a worked-in pod, so this is the
    // boot (resume) path — never the first-run kickoff, which would re-greet.
    agentCommandFor: (a: string) => bootCommandForAgent(a, mode, agentAuth),
    // The declared shape the watchdog repairs toward.
    declaredAgents: readAgents(),
    // Same name Claude uses for its RC session title, so the Codex app, the Claude
    // app and the dashboard all call this pod the same thing.
    displayName: readSessionName(),
    // Login→kickoff separation: only when the env declares a kickoff — without
    // one, restarting the CLI after login would gain nothing.
    authedRespawn: existsSync(KICKOFF_PATH)
      ? {
          credsPath: credentialsPathForAgent(agent),
          command: kickoffCommandForAgent(agent, mode, agentAuth),
        }
      : undefined,
    // Greeter (claude only): enable remote control (titled with the pod's
    // display name) + type the kickoff trigger, verified (greeter.ts).
    greeter:
      agent !== "codex"
        ? {
            rcTitle: sanitizeSessionName(sessionName),
            agentAuth,
            kickoffTrigger: existsSync(KICKOFF_PATH) ? KICKOFF_TRIGGER : undefined,
            // Cold restart of an already-greeted pod: nudge the resumed agent so
            // it orients instead of sitting silent in a seemingly-empty session. When
            // the restart was an OOM, the nudge leads with an owner-facing notice.
            resumeTrigger: existsSync(KICKOFF_PATH) ? resumeNudge() : undefined,
          }
        : undefined,
    host: process.env.PODBAY_AGENT_HOST ?? "::",
    port: Number(process.env.PODBAY_AGENT_PORT ?? 8080),
  });
  const { host, port } = await server.listen();
  log.info("listening", { host, port, agent, uid: isRoot ? 1000 : "self" });

  // ADDED agents (spec.agents beyond the primary) get their windows respawned on
  // every boot. Without this, an image update / restart silently DROPPED them:
  // the recreate preserved the spec but only the primary's session was rebuilt,
  // leaving the DB claiming an agent the pod didn't run (live find, pod "ttt",
  // 2026-07-29). spawnAgentWindow is idempotent by window name, so this is safe
  // on every start. Boot = the resume path — never the first-run kickoff.
  const extraAgents = readAgents().slice(1);
  if (extraAgents.length > 0) {
    const { spawnAgentWindow } = await import("./signals.js");
    for (const a of extraAgents) {
      spawnAgentWindow("main", a, bootCommandForAgent(a, mode, agentAuth), {
        uid: isRoot ? 1000 : undefined,
        gid: isRoot ? 1000 : undefined,
      })
        .then((w) => log.info("added_agent_respawned", { agent: a, window: w }))
        .catch((e) => log.warn("added_agent_respawn_failed", { agent: a, err: String(e) }));
    }
  }

  // Recurring scheduled JOBS (morning-ops-robot / operations bot). Started
  // unconditionally: it no-ops unless a jobs config exists (only that playbook
  // writes one), injecting each due job's run turn into the same "main" session
  // as the greeter, gated on the agent being idle. Config + bookkeeping + run log
  // live in ~/.podbay — on the persistent /home/dev volume (a restart keeps them)
  // but OUTSIDE the ~/work git tree, where a reset/checkout/clean (BYO repos don't
  // gitignore .podbay) would corrupt live schedule state. Migrated from the old
  // ~/work/.podbay location on first boot after this ships.
  const opsDir = path.join(home, ".podbay");
  try {
    mkdirSync(opsDir, { recursive: true });
    if (isRoot) chownSync(opsDir, 1000, 1000);
    const oldOpsDir = path.join(home, "work", ".podbay");
    for (const f of ["ops-jobs.json", "ops-state.json", "ops-runs.jsonl"]) {
      const from = path.join(oldOpsDir, f);
      const to = path.join(opsDir, f);
      if (existsSync(from) && !existsSync(to)) renameSync(from, to); // same volume ⇒ atomic, keeps owner
    }
  } catch {
    /* best-effort: a fresh pod has nothing to migrate */
  }
  startScheduler({
    sessionName: "main",
    jobsPath: path.join(opsDir, "ops-jobs.json"),
    statePath: path.join(opsDir, "ops-state.json"),
    runsLogPath: path.join(opsDir, "ops-runs.jsonl"),
    uid: isRoot ? 1000 : undefined,
    gid: isRoot ? 1000 : undefined,
  });

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      void server.close().finally(() => process.exit(0));
    });
  }
}

function readSpec(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync("/etc/podbay/pod-spec.json", "utf8"));
  } catch {
    return {};
  }
}

function readPermissionMode(): string {
  const perms = readSpec().permissions as { mode?: string } | undefined;
  return perms?.mode ?? DEFAULT_PERMISSION_MODE;
}

/** How this pod authenticates its agent: "api-key" (BYO key, no /login) or the
 * default "subscription". From the pod-spec; unknown/absent → subscription. */
function readAgentAuth(): AgentAuth {
  return readSpec().agentAuth === "api-key" ? "api-key" : "subscription";
}

function readAgent(): string {
  return readAgents()[0] ?? "claude-code";
}

/** Every agent the spec declares for THIS pod, primary first. The provider keeps
 * spec.agents current when an agent is added, so a recreate can rebuild all of
 * them — the DB and the pod must never disagree about who runs here. */
function readAgents(): string[] {
  try {
    const spec = readSpec();
    return Array.isArray(spec.agents) && spec.agents.length > 0
      ? (spec.agents as string[])
      : ["claude-code"];
  } catch {
    return ["claude-code"];
  }
}

/** Remote-control session title. Prefer the user's display name (podName) so the
 * app's session list matches the dashboard; fall back to "<envName>: <slug>". */
function readSessionName(): string {
  const spec = readSpec();
  const podName = typeof spec.podName === "string" ? spec.podName.trim() : "";
  if (podName) return podName;
  const envName = typeof spec.envName === "string" ? spec.envName : "";
  const slug = typeof spec.slug === "string" ? spec.slug : "";
  if (envName && slug) return `${envName}: ${slug}`;
  return envName || slug || "podbay pod";
}

main().catch((e) => {
  log.error("start_failed", { err: e });
  process.exit(1);
});
