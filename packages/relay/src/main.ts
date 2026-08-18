#!/usr/bin/env node
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  load,
  save,
  addLoginDomain,
  resetProfile,
  profileDir,
  pidFile,
  dashboardRuntimeFile,
  isDomainBlocked,
  isPodPaused,
  revokeLoginDomain,
  RelayConfig,
} from "./config.js";
import { RelayClient } from "./relay-client.js";
import { RelayTunnel } from "./relay-tunnel.js";
import { keepAwake } from "./keep-awake.js";
import { BrowserFetcher } from "./browser-fetcher.js";
import { RelayEventStore, type RelaySource } from "./audit.js";
import { serveDashboard } from "./dashboard.js";
import { RelayRuntime } from "./runtime.js";
import { attachHeartbeat } from "./heartbeat.js";
import { DISCLOSURE } from "./disclosure.js";
import { c, rows } from "./colors.js";
import { normalizeDomain } from "./domain.js";

/**
 * `relay` — one command starts a background relay; login/dashboard/stop modify it
 * through disk state (config, audit log, pidfile). No per-request approval: once
 * running, the pod fetches the public web freely; the owner watches via the dashboard.
 */
process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); });
const log = (s = ""): void => { try { process.stdout.write(s + "\n"); } catch { /* EPIPE */ } };
const die = (s: string): never => { process.stderr.write(`relay: ${s}\n`); process.exit(1); };
const arg = (a: string[], f: string) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };

function isRunning(): number | null {
  try {
    const pid = Number(readFileSync(pidFile(), "utf8").trim());
    process.kill(pid, 0); // throws if not alive
    return pid;
  } catch {
    return null;
  }
}

interface DashboardRuntimeRecord { pid: number; url: string; startedAt: string }

function dashboardUrl(): string | null {
  try {
    const record = JSON.parse(readFileSync(dashboardRuntimeFile(), "utf8")) as DashboardRuntimeRecord;
    process.kill(record.pid, 0);
    const url = new URL(record.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !/^\/[a-f0-9]{64}$/.test(url.pathname)) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function openBrowser(url: string): void {
  const opener = process.platform === "darwin"
    ? { command: "open", args: [url] }
    : process.platform === "win32"
      ? { command: "cmd", args: ["/c", "start", "", url] }
      : { command: "xdg-open", args: [url] };
  const child = spawn(opener.command, opener.args, { stdio: "ignore", detached: true });
  child.on("error", () => log(`open this URL in a browser: ${url}`));
  child.unref();
}

async function waitForDashboardUrl(timeoutMs = 2000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = dashboardUrl();
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function cmdStart(a: string[]): Promise<void> {
  if (a.includes("__daemon")) return runDaemon(a);
  if (isRunning()) die("a relay is already running (relay stop to stop it).");

  const cfg = load();
  const gateway = arg(a, "--gateway") ?? cfg.gatewayUrl ?? die("need --gateway wss://…");
  // A code is only needed for FIRST pairing; a stored reconnect token lets a plain
  // `relay start` bring the relay back up (e.g. after a reboot) with no new code.
  const code = arg(a, "--code") ?? "";
  if (!code && !cfg.reconnectToken) die("need --code (from your pod dashboard) to pair the first time");

  if (!cfg.consentedAt) {
    log(DISCLOSURE);
    if (!a.includes("--accept")) die("\nre-run with --accept to agree and start the relay.");
    cfg.consentedAt = new Date().toISOString();
  }
  cfg.gatewayUrl = gateway;
  // Opt-in keep-awake (persisted, so it survives `relay stop`/restart). `--no-keep-awake` turns it off.
  if (a.includes("--keep-awake")) cfg.keepAwake = true;
  else if (a.includes("--no-keep-awake")) cfg.keepAwake = false;
  save(cfg);
  try { unlinkSync(dashboardRuntimeFile()); } catch {}

  // Spawn ourselves detached: one command, then it runs in the background.
  mkdirSync(profileDir().replace(/\/profile$/, ""), { recursive: true });
  const self = fileURLToPath(import.meta.url);
  const daemonArgs = [self, "start", "__daemon", "--gateway", gateway, "--code", code];
  if (cfg.keepAwake) daemonArgs.push("--keep-awake");
  const child = spawn(process.execPath, daemonArgs, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  writeFileSync(pidFile(), String(child.pid), { mode: 0o600 });
  const commandCenter = await waitForDashboardUrl();
  log("");
  log(`  ${c.green(c.bold("✓ relay running"))} ${c.dim(`(pid ${child.pid}, in the background)`)}`);
  log("");
  log(
    rows([
      ["relay dashboard", "see what it has fetched"],
      ["relay login <site>", "let a site be fetched as you"],
      ["relay stop", "stop it"],
    ]),
  );
  if (commandCenter) log(`\n  ${c.dim("command center")}  ${c.cyan(commandCenter)}`);
  log("");
}

async function runDaemon(a: string[]): Promise<void> {
  const gateway = arg(a, "--gateway")!;
  const code = arg(a, "--code") ?? "";
  const browser = new BrowserFetcher({
    profileDir: profileDir(),
    // Re-read config each fetch: `relay login` writes there and we pick it up live.
    isSessionDomain: (host) => load().loginDomains.some((d) => host === d || host.endsWith(`.${d}`)),
  });
  const cfgAtStart = load();
  const store = new RelayEventStore({ retentionDays: cfgAtStart.retentionDays ?? 30 }).init();
  const runtime = new RelayRuntime({ version: "0.1.7" });
  // Opt-in: keep the Mac from idle-sleeping the relay (a 24/7 host). Released on stop AND — via
  // caffeinate's `-w <pid>` — automatically if we crash, so it never gets stuck holding the Mac awake.
  const releaseKeepAwake =
    a.includes("--keep-awake") || cfgAtStart.keepAwake ? keepAwake(log) : () => {};
  let stopping = false;
  let dashboardClose: (() => void) | undefined;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    releaseKeepAwake();
    runtime.clearActive();
    dashboardClose?.();
    await browser.close();
    try { unlinkSync(pidFile()); } catch {}
    try { unlinkSync(dashboardRuntimeFile()); } catch {}
    process.exit(0);
  };
  try {
    const dashboard = await serveDashboard(7373, {
      store,
      runtime,
      config: load,
      actions: {
        stop: () => { setTimeout(() => void stop(), 25); },
        revokeSession: async (domain) => {
          revokeLoginDomain(domain);
          await browser.revokeDomain(domain).catch(() => undefined);
        },
      },
    });
    dashboardClose = dashboard.close;
    mkdirSync(profileDir().replace(/\/profile$/, ""), { recursive: true, mode: 0o700 });
    writeFileSync(dashboardRuntimeFile(), JSON.stringify({ pid: process.pid, url: dashboard.url, startedAt: new Date().toISOString() }), { mode: 0o600 });
  } catch {
    // Oversight UI is best-effort: it must never prevent the relay transport starting.
  }
  let backoff = 1000;
  // Prefer a stored reconnect token (survives restarts/blips) over the one-time code,
  // which is spent the instant the first pairing succeeds.
  let token = load().reconnectToken;

  const connect = () => {
    const base = gateway.replace(/\/$/, "");
    // A token reconnects; the code is only for the very first pairing.
    const auth = token ? `token=${encodeURIComponent(token)}` : `code=${encodeURIComponent(code)}`;
    const ws = new WebSocket(`${base}/relay?${auth}`);
    const sink = { send: (j: string) => { try { ws.send(j); } catch { /* closing */ } } };
    const deny = (source: RelaySource | undefined, host: string): string | undefined => {
      const cfg = load();
      if (source && "podId" in source && isPodPaused(cfg, source.podId)) return `pod ${source.podId} is paused by the relay owner`;
      if (isDomainBlocked(cfg, host)) return `${host} is blocked by the relay owner`;
      return undefined;
    };
    const client = new RelayClient(sink, browser.fetch, { audit: (event) => store.append(event), runtime, deny });
    // The SAME relay also serves the egress tunnel: the pod's apps connect through here
    // and egress from this machine. One `relay start`, both consumers.
    const tunnel = new RelayTunnel(sink, {
      // Tunnel connections land in the SAME local audit as fetches, so `relay
      // dashboard` shows one history: host, whether it was allowed, and why not.
      audit: (event) => { store.append(event); },
      runtime,
      deny,
    });
    ws.on("open", () => {
      backoff = 1000;
      runtime.setGateway("connected");
      sink.send(JSON.stringify({ type: "relay-online", loginDomains: load().loginDomains }));
      // Detect a zombie link (slept laptop / network change): without this a half-open
      // socket never fires `close`, so the reconnect below never runs. The heartbeat
      // terminate()s a silent link → `close` fires → reconnect. ~15s worst-case detection
      // (10s ping + 5s pong). Self-clears on close.
      attachHeartbeat(ws);
    });
    ws.on("message", (d) => {
      const raw = String(d);
      // The gateway hands us a durable reconnect token at pairing — persist it so every
      // future reconnect uses it, not the now-spent code.
      try {
        const m = JSON.parse(raw) as { type?: string; token?: string };
        if (m.type === "relay-hello" && typeof m.token === "string" && m.token && m.token !== token) {
          token = m.token;
          const cfg = load();
          cfg.reconnectToken = token;
          save(cfg);
        }
        // Tunnel frames are handled here, not by the fetch client.
        if (m.type?.startsWith("tunnel-")) {
          tunnel.handle(m as Parameters<typeof tunnel.handle>[0]);
          return;
        }
      } catch { /* not our frame */ }
      void client.onMessage(raw);
    });
    ws.on("error", () => {});
    ws.on("close", (c) => {
      // The link is gone — no stream can be served, so close them all rather than
      // leaving the pod's apps hanging.
      tunnel.closeAll();
      if (stopping) return;
      runtime.setGateway(c === 4401 ? "unavailable" : "reconnecting");
      // 4401 = the credential was rejected. If we were using a token that expired/was
      // revoked, fall back to the code ONCE (re-pair); if the code itself is rejected,
      // give up — retrying is pointless.
      if (c === 4401) {
        if (token) { token = undefined; setTimeout(connect, 500); return; }
        return void stop();
      }
      // Otherwise a blip or a slept laptop — reconnect with backoff so the relay
      // survives without the owner restarting it.
      setTimeout(connect, Math.min(backoff, 30_000));
      backoff *= 2;
    });
  };

  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
  connect();
}

async function cmdLogin(a: string[]): Promise<void> {
  const domain = normalizeDomain(a[0] ?? die("usage: relay login <domain>"));
  const pw = (await import("playwright").catch(() =>
    die("Playwright missing — reinstall: npx @podbay/relay@latest"),
  )) as typeof import("playwright");
  log(`opening a browser so you can sign in to ${domain}. This is the relay's OWN profile.`);
  const ctx = await pw.chromium.launchPersistentContext(profileDir(), { headless: false, channel: "chrome" });
  const first = await ctx.newPage();
  await first.goto(`https://${domain}`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  log("");
  log(`  ${c.bold("sign in")} ${c.dim("(2FA included), then close the browser —")} ${c.bold("or press Enter here")} ${c.dim("when done.")}`);
  log(`  ${c.dim("I'll save the session and quit the browser for you.")}`);

  // Wait until the owner is done. Belt-and-suspenders so it CANNOT hang (live-caught
  // 2026-08-03: closing tabs left Chrome alive with a lingering page, so pages()===0
  // never fired and the CLI hung). We resolve on ANY of: all pages closed, the browser
  // disconnecting, OR the owner pressing Enter — whichever comes first.
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      process.stdin.off("data", onEnter);
      process.stdin.pause();
      resolve();
    };
    const closedNow = () => ctx.pages().length === 0;
    const check = () => setTimeout(() => closedNow() && finish(), 100);
    ctx.on("close", finish);
    ctx.on("page", (p) => p.on("close", check));
    for (const p of ctx.pages()) p.on("close", check);
    // Chrome fully quit / crashed — a hard "window is gone" signal the page events miss.
    (ctx as unknown as { browser?(): { on(e: string, f: () => void): void } | null }).browser?.()?.on?.("disconnected", finish);
    // Fallback poll — catches tab-close semantics the events miss, and a context that
    // has become unusable (throwing = gone).
    const poll = setInterval(() => {
      try { if (closedNow()) finish(); } catch { finish(); }
    }, 1000);
    // Manual escape hatch — the owner is never stuck if auto-detect misses their close.
    const onEnter = () => finish();
    process.stdin.resume();
    process.stdin.once("data", onEnter);
  });

  // Did a session actually land? Read cookies for the domain BEFORE closing, so "saved"
  // isn't a lie when the sign-in never completed (owner's doubt, 2026-08-03).
  let hasSession = false;
  try {
    const cookies = await ctx.cookies(`https://${domain}`).catch(() => [] as unknown[]);
    hasSession = Array.isArray(cookies) && cookies.length > 0;
  } catch { /* context already gone — can't verify, don't overclaim */ }

  // Fully close the context → quits the Chrome the relay launched → releases the
  // profile lock so the daemon can open it for session fetches.
  await ctx.close().catch(() => undefined);
  addLoginDomain(domain);
  log("");
  if (hasSession) {
    log(`  ${c.green("✓ signed in")} ${c.dim(`— ${domain} will now be fetched as you; every other site stays clean.`)}`);
  } else {
    log(`  ${c.yellow("⚠ saved, but I didn't see a session")} ${c.dim(`for ${domain}. If a fetch hits a login wall, run`)} ${c.bold(`relay login ${domain}`)} ${c.dim("again and complete the sign-in.")}`);
  }
  log("");
}

async function cmdDashboard(a: string[]): Promise<void> {
  const port = Number(arg(a, "--port") ?? 7373);
  const preview = a.includes("--preview");
  if (!preview) {
    const liveUrl = dashboardUrl();
    if (liveUrl) {
      log(`relay command center: ${liveUrl}`);
      log("(served by the running relay — detailed history stays on this computer.)");
      openBrowser(liveUrl);
      return;
    }
  }
  const cfg = load();
  const store = preview ? undefined : new RelayEventStore({ retentionDays: cfg.retentionDays ?? 30 }).init();
  const runtime = preview ? undefined : new RelayRuntime({ daemon: "stopped" });
  const { url } = await serveDashboard(port, { preview, store, runtime, readOnly: !preview });
  log(`relay dashboard: ${url}`);
  log(preview
    ? "(UX preview — sample multi-pod activity; controls are simulated. Ctrl-C to close.)"
    : "(relay stopped — read-only saved history; local to this computer. Ctrl-C to close.)");
  openBrowser(url);
  await new Promise(() => {}); // stay up until Ctrl-C
}

async function cmdStatus(): Promise<void> {
  const pid = isRunning();
  const cfg = load();
  // Pad wider than the longest label ("dashboard", 9) so every value has a gutter —
  // padEnd(9) left "dashboard" flush against its URL.
  const label = (s: string) => c.dim(s.padEnd(11));
  log("");
  log(`${label("relay")}${pid ? c.green(`running`) + c.dim(` (pid ${pid})`) : c.yellow("not running")}`);
  // The PROCESS being alive is not the same as the gateway LINK being up — a slept host
  // leaves a dead link the process can't see. Ask the daemon's own dashboard for the
  // live state so status stops reporting "running" over a dead link.
  if (pid) log(`${label("link")}${await gatewayLinkState()}`);
  log(`${label("gateway")}${cfg.gatewayUrl ? c.cyan(cfg.gatewayUrl) : c.dim("(unset)")}`);
  log(`${label("dashboard")}${dashboardUrl() ? c.cyan(dashboardUrl()!) : c.dim("relay dashboard opens saved history")}`);
  log(
    `${label("as-you")}${
      cfg.loginDomains.length ? cfg.loginDomains.join(", ") : c.dim("no sites signed in — all fetches are clean")
    }`,
  );
  log("");
}

/** Live gateway-link state, read from the running daemon's local dashboard (`/data`).
 * The daemon owns this in memory ("never state files"), so a separate `relay status`
 * can only learn it by asking the daemon — this is what makes status honest about a
 * link that dropped (host asleep/offline) instead of just "the process is alive". */
async function gatewayLinkState(): Promise<string> {
  const base = dashboardUrl();
  if (!base) return c.dim("unknown (dashboard not up yet)");
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 1500);
    const res = await fetch(`${base}/data`, { signal: ac.signal }).finally(() => clearTimeout(timer));
    const data = (await res.json()) as { state?: string };
    if (data.state === "connected") return c.green("connected");
    if (data.state === "reconnecting") return c.yellow("reconnecting… (host asleep or offline)");
    if (data.state === "stopped") return c.yellow("stopped");
    return c.dim("unknown");
  } catch {
    return c.yellow("unreachable — the relay daemon isn't responding (try: relay restart)");
  }
}

/** Stop-then-start, reusing the stored gateway + reconnect token. The escape hatch for a
 * link that won't come back on its own — though the heartbeat should now auto-recover it. */
async function cmdRestart(a: string[]): Promise<void> {
  const pid = isRunning();
  if (pid) {
    process.kill(pid, "SIGTERM");
    try { unlinkSync(pidFile()); } catch {}
    await new Promise((r) => setTimeout(r, 600)); // let it release the pid + dashboard port
    log(c.dim("restarting the relay…"));
  } else {
    log(c.dim("no relay was running — starting it."));
  }
  return cmdStart(a);
}

function cmdStop(): void {
  const pid = isRunning();
  if (!pid) return log(c.dim("no relay running."));
  process.kill(pid, "SIGTERM");
  try { unlinkSync(pidFile()); } catch {}
  log(`${c.green("✓")} relay stopped.`);
}

async function dispatch(a: string[]): Promise<void> {
  switch (a[0]) {
    case "start": return cmdStart(a.slice(1));
    case "login": return cmdLogin(a.slice(1));
    case "dashboard": return cmdDashboard(a.slice(1));
    case "status": return cmdStatus();
    case "stop": return cmdStop();
    case "restart": return cmdRestart(a.slice(1));
    case "reset": resetProfile(); return log(`${c.green("✓")} wiped the relay's sessions, logins, and pairing.`);
    default:
      return usage();
  }
}

function usage(): void {
  log("");
  log(`${c.bold("relay")} ${c.dim("— fetch web pages through this machine for your Podbay pods")}`);
  log("");
  // `start` carries flags, so it gets its own line rather than blowing out the column.
  log(`  ${c.cyan("start")}  ${c.dim("run the relay in the background:")}`);
  log(`         ${c.dim("relay start --gateway <url> --code <code> --accept")}`);
  log("");
  log(
    rows([
      ["login <site>", "let one site be fetched as you (everything else stays clean)"],
      ["dashboard", "open a local page of what it has fetched"],
      ["status", "is it running, is the gateway link up, and for which sites"],
      ["stop", "stop the relay"],
      ["restart", "stop then start it (e.g. after the host slept)"],
      ["reset", "forget all sessions, logins, and pairing"],
    ]),
  );
  log("");
}

async function main(): Promise<void> {
  const [, , ...args] = process.argv;
  // The binary IS `relay` now, so commands are top-level (`relay start`, `relay login <site>`).
  // Tolerate a stray leading `relay` — old `relay …` muscle memory, and the daemon's own
  // respawn — so `relay relay start` still resolves.
  if (args[0] === "relay") args.shift();
  return dispatch(args);
}
void main();
