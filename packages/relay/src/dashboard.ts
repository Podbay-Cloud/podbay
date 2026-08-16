import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { RelayEventStore } from "./audit.js";
import { RelayEventStore as LocalEventStore } from "./audit.js";
import {
  eventsDir,
  load,
  setDomainBlocked,
  setPodPaused,
  setRetentionDays,
  type RelayConfig,
} from "./config.js";
import { RelayRuntime, type RelayRuntimeSnapshot } from "./runtime.js";

export interface DashboardEvent {
  id: string;
  at: string;
  podId?: string;
  /** Gateway-resolved display name; the UI shows this in place of podId when present. */
  podName?: string;
  mode: "fetch" | "tunnel";
  outcome: "ok" | "site-refused" | "owner-blocked" | "safety-blocked" | "rate-limited" | "network-error";
  target: string;
  host: string;
  status?: number;
  ms: number;
  session: boolean;
  bytesUp?: number;
  bytesDown?: number;
  reason?: string;
}

export interface DashboardData {
  preview: boolean;
  state: "connected" | "reconnecting" | "stopped";
  stateSince: string;
  updatedAt: string;
  events: DashboardEvent[];
  active: Array<{
    id: string;
    podId?: string;
    podName?: string;
    mode: "fetch" | "tunnel";
    target: string;
    startedAt: string;
    bytesUp?: number;
    bytesDown?: number;
  }>;
  signedInSites: string[];
  blockedSites: string[];
  pausedPods: string[];
  retentionDays: 7 | 30 | 90;
  storagePath: string;
  storageBytes: number;
  trend: number[];
}

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function json(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { ...SECURITY_HEADERS, "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function previewData(now = Date.now()): DashboardData {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const events: DashboardEvent[] = [
    { id: "ev-1", at: ago(2 * 60_000), podId: "research-otter-7f2a", podName: "Research Otter", mode: "fetch", outcome: "ok", target: "https://www.reddit.com/r/programming", host: "reddit.com", status: 200, ms: 2380, session: true },
    { id: "ev-2", at: ago(8 * 60_000), podId: "market-scout-a912", podName: "Market Scout", mode: "tunnel", outcome: "ok", target: "www.linkedin.com:443", host: "linkedin.com", ms: 18_420, session: false, bytesUp: 83_291, bytesDown: 2_842_118 },
    { id: "ev-3", at: ago(19 * 60_000), podId: "research-otter-7f2a", podName: "Research Otter", mode: "fetch", outcome: "site-refused", target: "https://www.crunchbase.com/organization/linear", host: "crunchbase.com", status: 403, ms: 1104, session: false, reason: "The site returned 403 Forbidden" },
    { id: "ev-4", at: ago(37 * 60_000), podId: "docs-indexer-31bc", podName: "Docs Indexer", mode: "fetch", outcome: "ok", target: "https://docs.anthropic.com/en/docs/agents", host: "docs.anthropic.com", status: 200, ms: 892, session: false },
    { id: "ev-5", at: ago(54 * 60_000), podId: "market-scout-a912", podName: "Market Scout", mode: "tunnel", outcome: "safety-blocked", target: "192.168.1.1:80", host: "192.168.1.1", ms: 1, session: false, bytesUp: 0, bytesDown: 0, reason: "Private-network targets are never reachable through the relay" },
    { id: "ev-6", at: ago(75 * 60_000), podId: "research-otter-7f2a", podName: "Research Otter", mode: "fetch", outcome: "ok", target: "https://news.ycombinator.com/item", host: "news.ycombinator.com", status: 200, ms: 613, session: false },
    { id: "ev-7", at: ago(2.2 * 60 * 60_000), podId: "market-scout-a912", podName: "Market Scout", mode: "tunnel", outcome: "network-error", target: "api.producthunt.com:443", host: "api.producthunt.com", ms: 10_004, session: false, bytesUp: 1843, bytesDown: 0, reason: "The remote host closed the connection" },
    { id: "ev-8", at: ago(3.4 * 60 * 60_000), podId: "docs-indexer-31bc", podName: "Docs Indexer", mode: "fetch", outcome: "ok", target: "https://developer.mozilla.org/en-US/docs/Web/API", host: "developer.mozilla.org", status: 200, ms: 724, session: false },
    { id: "ev-9", at: ago(4.1 * 60 * 60_000), podId: "research-otter-7f2a", podName: "Research Otter", mode: "fetch", outcome: "rate-limited", target: "https://www.reddit.com/r/MachineLearning", host: "reddit.com", status: 429, ms: 486, session: true, reason: "The site asked the relay to slow down" },
    { id: "ev-10", at: ago(5.7 * 60 * 60_000), podId: "market-scout-a912", podName: "Market Scout", mode: "tunnel", outcome: "ok", target: "www.g2.com:443", host: "g2.com", ms: 44_201, session: false, bytesUp: 219_405, bytesDown: 6_139_551 },
    { id: "ev-11", at: ago(9.5 * 60 * 60_000), mode: "tunnel", outcome: "ok", target: "relay.podbay.cloud:443", host: "relay.podbay.cloud", ms: 312, session: false, bytesUp: 0, bytesDown: 0, reason: "Automatic relay health check" },
  ];
  return {
    preview: true,
    state: "connected",
    stateSince: ago(3.7 * 60 * 60_000),
    updatedAt: new Date(now).toISOString(),
    events,
    active: [
      { id: "live-1", podId: "market-scout-a912", podName: "Market Scout", mode: "tunnel", target: "www.linkedin.com:443", startedAt: ago(72_000), bytesUp: 42_831, bytesDown: 1_284_921 },
      { id: "live-2", podId: "research-otter-7f2a", podName: "Research Otter", mode: "fetch", target: "https://www.reddit.com/r/startups", startedAt: ago(4_800) },
    ],
    signedInSites: ["reddit.com", "linkedin.com"],
    blockedSites: ["x.com"],
    pausedPods: [],
    retentionDays: 30,
    storagePath: "~/.podbay/relay/events",
    storageBytes: 3_842_117,
    trend: [3, 5, 4, 8, 6, 7, 12, 9, 14, 11, 18, 15, 21, 17, 24, 19, 28, 23],
  };
}

export type DashboardFixture = "active" | "empty" | "healthy" | "failures" | "signed-in" | "legacy" | "stopped" | "large";

export function fixtureData(name: DashboardFixture, now = Date.now()): DashboardData {
  const data = previewData(now);
  if (name === "active") return data;
  if (name === "empty") return { ...data, events: [], active: [], signedInSites: [], blockedSites: [], trend: data.trend.map(() => 0) };
  if (name === "healthy") return { ...data, events: data.events.filter((event) => event.podId === "docs-indexer-31bc" && event.outcome === "ok"), active: [], signedInSites: [], blockedSites: [] };
  if (name === "failures") return { ...data, events: data.events.filter((event) => event.outcome !== "ok"), active: [] };
  if (name === "signed-in") return { ...data, events: data.events.filter((event) => event.session), active: [] };
  if (name === "legacy") return { ...data, events: [{ ...data.events[0]!, id: "legacy-unknown", podId: undefined }], active: [] };
  if (name === "stopped") return { ...data, preview: false, state: "stopped", active: [] };
  const seed = data.events;
  return { ...data, events: Array.from({ length: 600 }, (_, index) => ({ ...seed[index % seed.length]!, id: `large-${index}`, at: new Date(now - index * 60_000).toISOString() })), active: [] };
}

function currentData(store: RelayEventStore, runtime: RelayRuntimeSnapshot, cfg: RelayConfig, now = Date.now()): DashboardData {
  const events: DashboardEvent[] = store.query({ limit: 10_000 }).map((event) => ({
    id: event.id,
    at: event.startedAt,
    ...(event.source && "podId" in event.source ? { podId: event.source.podId } : {}),
    ...(event.source && "podId" in event.source && event.source.podName ? { podName: event.source.podName } : {}),
    mode: event.mode,
    outcome: event.outcome,
    target: event.target,
    host: event.host,
    ...(event.httpStatus !== undefined ? { status: event.httpStatus } : {}),
    ms: event.durationMs,
    session: event.session,
    ...(event.bytesUp !== undefined ? { bytesUp: event.bytesUp } : {}),
    ...(event.bytesDown !== undefined ? { bytesDown: event.bytesDown } : {}),
    ...(event.reason ? { reason: event.reason } : {}),
  }));
  const trend = Array.from({ length: 18 }, (_, index) => {
    const end = now - (17 - index) * 3_600_000;
    const start = end - 3_600_000;
    return events.filter((event) => { const at = Date.parse(event.at); return at > start && at <= end; }).length;
  });
  return {
    preview: false,
    state: runtime.daemon === "stopped" ? "stopped" : runtime.gateway === "connected" ? "connected" : "reconnecting",
    stateSince: runtime.stateSince,
    updatedAt: runtime.updatedAt,
    events,
    active: runtime.active.map((work) => ({
      id: work.id,
      ...(work.source && "podId" in work.source ? { podId: work.source.podId } : {}),
      ...(work.source && "podId" in work.source && work.source.podName ? { podName: work.source.podName } : {}),
      mode: work.mode,
      target: work.target,
      startedAt: work.startedAt,
      ...(work.bytesUp !== undefined ? { bytesUp: work.bytesUp } : {}),
      ...(work.bytesDown !== undefined ? { bytesDown: work.bytesDown } : {}),
    })),
    signedInSites: cfg.loginDomains,
    blockedSites: cfg.blockedDomains ?? [],
    pausedPods: cfg.pausedPodIds ?? [],
    retentionDays: cfg.retentionDays ?? 30,
    storagePath: store.root,
    storageBytes: store.storageBytes(),
    trend,
  };
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relay · Podbay</title>
<style>
:root{color-scheme:dark;--bg:#09101d;--panel:#101a2b;--panel2:#142139;--line:#22324d;--text:#edf2f8;--muted:#91a0b7;--blue:#5d8dff;--blue2:#2f6bff;--green:#59d99b;--amber:#f3bd58;--red:#ee7f79;--violet:#b19bff;--radius:15px;--shadow:0 18px 60px #02060d66;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}html{background:var(--bg);scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 15% -15%,#183160 0,transparent 28rem),var(--bg);color:var(--text);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}button,select,input{font:inherit}button{cursor:pointer}button:focus-visible,select:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:2px solid #8eb1ff;outline-offset:2px}.wrap{width:min(1180px,calc(100% - 40px));margin:0 auto 80px}.preview-ribbon{min-height:36px;display:flex;align-items:center;justify-content:center;gap:9px;background:#17243b;color:#b8c6dc;border-bottom:1px solid var(--line);font-size:12px;font-weight:650;letter-spacing:.01em}.preview-ribbon strong{color:#fff}.topbar{height:76px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #21304a99}.brand{display:flex;align-items:center;gap:11px;font-size:16px;font-weight:730;letter-spacing:-.02em}.mark{width:29px;height:29px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(145deg,var(--blue),#3159c8);box-shadow:0 8px 24px #2f6bff55;color:#fff;font:800 16px/1 ui-monospace,monospace}.top-meta{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px}.local-pill{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid var(--line);background:#0d1727;border-radius:999px}.local-pill:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px #59d99b1f}.hero{padding:48px 0 30px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:30px;align-items:start}.eyebrow{margin:0 0 9px;text-transform:uppercase;letter-spacing:.13em;font-weight:750;font-size:11px;color:#82a7ff}.hero h1{font-size:clamp(34px,5vw,53px);line-height:1.03;letter-spacing:-.045em;margin:0 0 15px;font-weight:760}.hero-copy{max-width:690px;margin:0;color:#aab7ca;font-size:16px;line-height:1.65}.state-card{min-width:310px;padding:17px 18px;border:1px solid #2b4166;background:linear-gradient(145deg,#142540,#0e192a);border-radius:var(--radius);box-shadow:var(--shadow)}.state-line{display:flex;align-items:center;gap:10px;margin-bottom:9px}.state-dot{width:10px;height:10px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px #59d99b18}.state-card h2{font-size:15px;margin:0}.state-card p{font-size:12px;color:var(--muted);margin:0 0 14px;padding-left:20px}.state-actions{display:flex;gap:8px}.btn{border:1px solid var(--line);border-radius:9px;padding:8px 11px;background:#17243a;color:#dfe8f5;font-size:12px;font-weight:650;transition:.15s ease}.btn:hover{border-color:#4b6693;background:#1b2b46}.btn.danger{color:#ffb6b2;border-color:#713d43;background:#321b22}.btn.danger:hover{background:#472127}.btn.ghost{background:transparent}.btn.small{padding:6px 9px;font-size:11px}.section{margin-top:26px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:12px}.section h2{font-size:17px;letter-spacing:-.015em;margin:0}.section-kicker{font-size:12px;color:var(--muted);margin:4px 0 0}.mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mode-card{display:grid;grid-template-columns:42px 1fr;gap:14px;padding:17px;border:1px solid var(--line);background:#0e1829cc;border-radius:var(--radius)}.mode-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:12px;background:#1b2d4b;color:#9db9ff;font:750 13px/1 ui-monospace,monospace}.mode-card h3{font-size:13px;margin:1px 0 4px}.mode-card p{color:var(--muted);font-size:12px;margin:0;line-height:1.55}.mode-card b{color:#dbe5f3}.toolbar{display:flex;align-items:center;gap:8px}.select,.search{border:1px solid var(--line);background:#0e1828;color:#dfe8f5;border-radius:9px;padding:8px 31px 8px 10px;font-size:12px}.search{padding-right:10px;width:180px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric{position:relative;overflow:hidden;min-height:132px;padding:17px;border:1px solid var(--line);background:linear-gradient(150deg,#121e32,#0e1727);border-radius:var(--radius)}.metric-label{display:flex;align-items:center;justify-content:space-between;color:#a6b4c8;font-size:12px;font-weight:620}.metric-value{font-size:34px;line-height:1.1;letter-spacing:-.045em;margin-top:18px;font-weight:750;font-variant-numeric:tabular-nums}.metric-foot{margin-top:5px;color:var(--muted);font-size:11px}.metric-mark{width:7px;height:7px;border-radius:50%;background:var(--green)}.metric.issues .metric-mark{background:var(--amber)}.metric.session .metric-mark{background:var(--violet)}.attention{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:15px;padding:16px 17px;border:1px solid #715628;background:linear-gradient(95deg,#2b2217,#191b22 72%);border-radius:var(--radius)}.attention-icon{width:36px;height:36px;display:grid;place-items:center;border-radius:11px;background:#5d451f;color:#ffd68a;font-weight:800}.attention h3{font-size:13px;margin:0 0 3px}.attention p{font-size:12px;color:#c3ad88;margin:0}.trend-panel{display:grid;grid-template-columns:1fr 210px;gap:24px;padding:18px;border:1px solid var(--line);background:#0e1828;border-radius:var(--radius)}.chart{height:92px;display:flex;align-items:end;gap:7px;padding-top:8px}.bar{flex:1;min-width:5px;border-radius:4px 4px 2px 2px;background:linear-gradient(#658fff,#2e559f);opacity:.82;transition:.15s ease}.bar:hover{opacity:1;filter:brightness(1.18)}.trend-aside{border-left:1px solid var(--line);padding-left:22px;display:flex;flex-direction:column;justify-content:center}.trend-aside strong{font-size:24px;letter-spacing:-.03em}.trend-aside span{color:var(--muted);font-size:12px}.pods{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.pod{padding:17px;border:1px solid var(--line);background:#0f192a;border-radius:var(--radius);transition:.15s ease}.pod:hover{border-color:#3a527b;transform:translateY(-1px)}.pod.selected{border-color:#537fda;box-shadow:0 0 0 1px #537fda55;background:#121f35}.pod-top{display:flex;justify-content:space-between;gap:10px;align-items:start}.pod-name{font:650 12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#dce6f5;overflow-wrap:anywhere}.pod-seen{color:var(--muted);font-size:10px;margin-top:4px}.pod-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:16px 0 13px}.pod-stat b{display:block;font-size:15px;font-variant-numeric:tabular-nums}.pod-stat span{color:var(--muted);font-size:10px}.pod-foot{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding-top:12px}.pod-risk{font-size:11px;color:var(--muted)}.pod-risk.warn{color:#efbf68}.live-list,.events{border:1px solid var(--line);background:#0d1726;border-radius:var(--radius);overflow:hidden}.live-row{display:grid;grid-template-columns:100px 1fr 190px 130px;align-items:center;gap:14px;padding:14px 16px;border-bottom:1px solid var(--line)}.live-row:last-child{border:0}.pulse{display:inline-flex;align-items:center;gap:7px;color:#8ee7b9;font-size:11px;font-weight:680}.pulse:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px #59d99b18}.target{min-width:0}.target strong{display:block;font:590 12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.target span{color:var(--muted);font-size:10px}.live-meta{text-align:right}.live-meta b{display:block;font-size:12px;font-variant-numeric:tabular-nums}.live-meta span{font-size:10px;color:var(--muted)}.filters{display:flex;flex-wrap:wrap;gap:8px}.events-head,.event{display:grid;grid-template-columns:94px auto 88px minmax(150px,1fr) 105px 70px;align-items:center;gap:12px}.events-head{padding:10px 16px;background:#111d30;color:#74849d;font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:700}.event{position:relative;padding:13px 16px;border-top:1px solid var(--line);cursor:pointer}.event:hover{background:#111d30}.event-time{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}.pod-chip,.mode-chip,.outcome{display:inline-flex;align-items:center;width:max-content;max-width:100%;border-radius:7px;font-size:10px;font-weight:650;white-space:nowrap}
.pod-chip{max-width:none;overflow:visible;text-overflow:clip}.pod-chip{padding:5px 7px;background:#16233a;color:#aebed5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.mode-chip{padding:5px 7px;border:1px solid #30486f;color:#9db8e8;text-transform:capitalize}.mode-chip.tunnel{border-color:#4e426e;color:#beaef0}.outcome{gap:6px;text-transform:capitalize}.outcome:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--green)}.outcome.bad{color:#f4c16b}.outcome.bad:before{background:var(--amber)}.outcome.blocked{color:#f09b94}.outcome.blocked:before{background:var(--red)}.bytes{text-align:right;font-size:11px;font-variant-numeric:tabular-nums;color:#b9c5d6}.event-detail{grid-column:1/-1;display:none;margin-top:3px;padding:12px;border-radius:9px;background:#0a1321;color:#a7b5c9;font-size:11px}.event.open .event-detail{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.detail-item b{display:block;color:#75869f;font-size:9px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px}.detail-item span{overflow-wrap:anywhere}.bottom-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px}.panel{border:1px solid var(--line);background:#0e1828;border-radius:var(--radius);overflow:hidden}.panel-title{padding:16px 17px 12px}.panel-title h3{font-size:14px;margin:0}.panel-title p{color:var(--muted);font-size:11px;margin:3px 0 0}.site-row{display:grid;grid-template-columns:1fr 80px 88px 82px;align-items:center;gap:10px;padding:12px 17px;border-top:1px solid var(--line);font-size:11px}.site-row b{font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.site-row span{text-align:right;color:#aebbd0;font-variant-numeric:tabular-nums}.setting{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:13px 17px;border-top:1px solid var(--line)}.setting b{display:block;font-size:11px}.setting p{margin:3px 0 0;color:var(--muted);font-size:10px}.tag-list{display:flex;gap:6px;flex-wrap:wrap}.tag{display:inline-flex;align-items:center;gap:5px;padding:5px 7px;border-radius:7px;background:#17243a;color:#b8c7dc;font-size:10px}.tag.signed:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--violet)}.tag.blocked{background:#301f26;color:#efaaa5}.empty{padding:28px;text-align:center;color:var(--muted);font-size:12px}.footer-note{display:flex;justify-content:space-between;gap:20px;margin-top:18px;color:#71819a;font-size:11px}.toast{position:fixed;right:22px;bottom:22px;z-index:20;max-width:340px;padding:12px 15px;border:1px solid #3a527b;border-radius:11px;background:#16233a;color:#e7eef8;box-shadow:var(--shadow);font-size:12px;opacity:0;transform:translateY(8px);pointer-events:none;transition:.18s ease}.toast.show{opacity:1;transform:none}.hidden{display:none!important}
.topbar{position:sticky;top:0;z-index:12;margin:0 -20px;padding:0 20px;background:#09101df2;backdrop-filter:blur(18px)}.header-right{display:flex;align-items:center;gap:10px}.header-state{display:flex;align-items:center;gap:8px;padding-right:4px}.header-state-copy{display:flex;flex-direction:column}.header-state-copy b{font-size:11px;line-height:1.2}.header-state-copy span{font-size:9px;color:var(--muted)}.state-dot.compact{width:8px;height:8px;box-shadow:0 0 0 4px #59d99b18}.tabs-shell{position:sticky;top:76px;z-index:11;display:flex;align-items:center;justify-content:space-between;gap:18px;margin:0 -20px;padding:0 20px;border-bottom:1px solid var(--line);background:#09101df2;backdrop-filter:blur(18px)}.tab-list{display:flex;align-items:center;gap:2px;min-width:0}.tab{position:relative;display:inline-flex;align-items:center;gap:7px;padding:15px 15px 13px;border:0;border-bottom:2px solid transparent;background:transparent;color:#8696ae;font-size:12px;font-weight:670}.tab:hover{color:#dce6f5}.tab[aria-selected="true"]{color:#f4f7fb;border-bottom-color:var(--blue)}.tab-badge{display:inline-grid;place-items:center;min-width:19px;height:18px;padding:0 5px;border-radius:999px;background:#1b2940;color:#aebed6;font-size:9px;font-variant-numeric:tabular-nums}.tab-badge.attention-count{background:#4b381d;color:#ffd081}.tab-range{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:10px}[data-tab-panel][hidden]{display:none}.tab-panel{padding-top:4px}.tab-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;padding:38px 0 4px}.tab-heading h1{font-size:28px;letter-spacing:-.035em;margin:0}.tab-heading p{margin:5px 0 0;color:var(--muted);font-size:13px}.overview-glance{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.glance-panel{border:1px solid var(--line);border-radius:var(--radius);background:#0e1828;overflow:hidden}.glance-head{display:flex;align-items:center;justify-content:space-between;padding:15px 16px;border-bottom:1px solid var(--line)}.glance-head h3{font-size:13px;margin:0}.compact-list{min-height:130px}.compact-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line)}.compact-row:last-child{border:0}.compact-row strong{display:block;font:600 11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.compact-row span{display:block;color:var(--muted);font-size:10px}.compact-value{text-align:right!important;color:#d9e3f1!important;font-variant-numeric:tabular-nums}.subtabs{display:inline-flex;padding:3px;border:1px solid var(--line);border-radius:10px;background:#0c1524}.subtab{border:0;border-radius:7px;padding:7px 12px;background:transparent;color:var(--muted);font-size:11px;font-weight:650}.subtab[aria-selected="true"]{background:#1a2941;color:#eef3fa;box-shadow:0 1px 3px #0005}.controls-layout{display:grid;grid-template-columns:330px minmax(0,1fr);gap:12px;margin-top:22px}.control-hero{padding:20px;border:1px solid #2d456c;border-radius:var(--radius);background:linear-gradient(150deg,#14243c,#0d1726)}.control-hero h2{font-size:17px;margin:0 0 7px}.control-hero>p{color:var(--muted);font-size:12px;margin:0 0 19px}.control-rule{display:flex;gap:11px;padding:13px 0;border-top:1px solid var(--line)}.control-rule:first-of-type{border-top:0}.control-rule i{width:26px;height:26px;display:grid;place-items:center;flex:0 0 auto;border-radius:8px;background:#1d3151;color:#9db9ff;font-style:normal;font-size:11px;font-weight:750}.control-rule b{display:block;font-size:11px}.control-rule span{display:block;margin-top:2px;color:var(--muted);font-size:10px;line-height:1.45}.controls-panel{align-self:start}.controls-footer{margin-top:14px}.hero{display:block;max-width:900px;padding-bottom:24px}.hero h1 br{display:none}
@media(max-width:900px){.hero{grid-template-columns:1fr}.state-card{min-width:0}.metrics{grid-template-columns:1fr 1fr}.pods{grid-template-columns:1fr}.trend-panel,.bottom-grid,.overview-glance,.controls-layout{grid-template-columns:1fr}.trend-aside{border-left:0;border-top:1px solid var(--line);padding:14px 0 0}.live-row{grid-template-columns:90px 1fr 110px}.live-meta:last-child{display:none}.events-head{display:none}.event{grid-template-columns:92px 96px 1fr}.event .target{grid-column:2/-1}.event .outcome{grid-column:2}.event .bytes{grid-column:3;grid-row:3}.event.open .event-detail{grid-template-columns:1fr 1fr}.mode-grid{grid-template-columns:1fr}.header-state-copy span{display:none}}
@media(max-width:700px){.topbar{height:64px}.tabs-shell{top:64px;overflow-x:auto;scrollbar-width:none}.tabs-shell::-webkit-scrollbar{display:none}.tab-list{flex:0 0 auto}.tab-range{display:none}.header-right .top-meta{display:none}.header-state-copy{display:none}.topbar .btn{padding:7px 9px}.tab{padding:13px 11px 11px}}
@media(max-width:580px){.wrap{width:min(100% - 24px,1180px)}.topbar{height:64px;margin:0 -12px;padding:0 12px}.tabs-shell{margin:0 -12px;padding:0 5px}.top-meta>span:first-child{display:none}.hero{padding-top:32px}.hero h1{font-size:36px}.hero-copy{font-size:14px}.metrics{grid-template-columns:1fr 1fr;gap:8px}.metric{min-height:116px;padding:14px}.metric-value{font-size:28px}.attention{grid-template-columns:auto 1fr}.attention .btn{grid-column:1/-1}.section-head,.tab-heading{align-items:start;flex-direction:column}.tab-heading{padding-top:28px}.toolbar{width:100%;flex-wrap:wrap}.select,.search{min-width:0;flex:1}.live-row{grid-template-columns:1fr 1fr}.live-row .target{grid-column:1/-1;grid-row:2}.event{grid-template-columns:1fr auto;gap:8px}.event-time{grid-column:1}.event .pod-chip{grid-column:1;grid-row:2}.event .mode-chip{grid-column:2;grid-row:2}.event .target{grid-column:1/-1;grid-row:3}.event .outcome{grid-column:1;grid-row:4}.event .bytes{grid-column:2;grid-row:4}.event.open .event-detail{grid-template-columns:1fr}.site-row{grid-template-columns:1fr 70px}.site-row span:nth-child(3),.site-row span:nth-child(4){display:none}.footer-note{flex-direction:column}.preview-ribbon{padding:7px 12px;text-align:center}.local-pill{padding:6px 8px}.tab{font-size:11px}.tab-badge{min-width:17px;height:16px}.controls-layout{margin-top:12px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}.pod:hover{transform:none}}
/* ---- refactor: consolidated filter bar, custom dropdowns, chart axis, load-more ---- */
.filterbar{display:flex;flex-direction:column;gap:11px;padding:14px 15px;border:1px solid var(--line);background:#0e1828;border-radius:var(--radius);margin-bottom:12px}
.filter-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px}
.filter-group{display:flex;align-items:center;gap:8px;min-width:0}
.filter-label{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#74849d;font-weight:700}
.seg{display:inline-flex;padding:3px;border:1px solid var(--line);border-radius:9px;background:#0c1524;gap:2px}
.seg button{border:0;border-radius:6px;padding:6px 11px;background:transparent;color:var(--muted);font-size:11px;font-weight:650}
.seg button[aria-pressed="true"]{background:#1a2941;color:#eef3fa;box-shadow:0 1px 3px #0005}
.seg button:hover{color:#dce6f5}
.checkrow{display:flex;flex-wrap:wrap;gap:6px}
.check{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:#0e1828;color:var(--muted);font-size:11px;font-weight:620}
.check:hover{border-color:#3a527b;color:#dce6f5}
.check[aria-pressed="true"]{border-color:#4b6693;background:#16233a;color:#eef3fa}
.check .box{width:13px;height:13px;border-radius:4px;border:1.5px solid #46587a;display:grid;place-items:center;font-size:9px;color:#0b1220;line-height:1}
.check[aria-pressed="true"] .box{background:var(--blue);border-color:var(--blue)}
.check .box:after{content:"";opacity:0}
.check[aria-pressed="true"] .box:after{content:"\\2713";opacity:1;color:#08111f;font-weight:800}
.dropdown{position:relative;display:inline-block}
.dd-btn{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:#0e1828;color:#dfe8f5;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:600}
.dd-btn:hover{border-color:#3a527b}
.dd-btn .caret{color:var(--muted);font-size:9px}
.dd-menu{position:absolute;z-index:30;top:calc(100% + 6px);left:0;min-width:200px;max-height:280px;overflow-y:auto;padding:5px;border:1px solid #33507d;border-radius:11px;background:#0f1c30;box-shadow:var(--shadow)}
.dd-menu[hidden]{display:none}
.dd-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:0;border-radius:7px;padding:8px 9px;background:transparent;color:#dbe5f3;font-size:12px;text-align:left}
.dd-opt:hover,.dd-opt.active{background:#1a2941}
.dd-opt[aria-selected="true"]{color:#fff}
.dd-opt .tick{color:var(--blue);opacity:0}
.dd-opt[aria-selected="true"] .tick{opacity:1}
.dd-opt small{color:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}
.search{padding:8px 10px;width:170px}
.active-filters{display:flex;flex-wrap:wrap;align-items:center;gap:7px}
.filter-chip{display:inline-flex;align-items:center;gap:7px;padding:5px 6px 5px 10px;border:1px solid #3a527b;border-radius:999px;background:#16233a;color:#dbe6f5;font-size:11px}
.filter-chip b{font-weight:680}
.filter-chip button{border:0;background:#22344f;color:#c9d6ea;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;font-size:10px;line-height:1}
.filter-chip button:hover{background:#32496c;color:#fff}
.showing-count{margin-left:auto;color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.loadmore{display:flex;justify-content:center;padding:14px}
.loadmore button{border:1px solid var(--line);background:#111d30;color:#cdd9ec;border-radius:9px;padding:9px 18px;font-size:12px;font-weight:650}
.loadmore button:hover{border-color:#4b6693;background:#16233a}
.chart-wrap{position:relative}
.chart-axis{display:flex;justify-content:space-between;margin-top:7px;color:#74849d;font-size:10px;font-variant-numeric:tabular-nums}
.chart-tip{position:absolute;z-index:5;pointer-events:none;transform:translate(-50%,-100%);padding:6px 9px;border:1px solid #33507d;border-radius:8px;background:#0f1c30;color:#eef3fa;font-size:11px;white-space:nowrap;box-shadow:var(--shadow);opacity:0;transition:opacity .12s ease}
.chart-tip.show{opacity:1}
.chart-tip b{font-variant-numeric:tabular-nums}
.bar{cursor:default}
.bar.peak{background:linear-gradient(#7ea6ff,#3a63b6)}
.podaccess-row{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:12px;padding:12px 17px;border-top:1px solid var(--line)}
.podaccess-row .pa-name{font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#dce6f5;overflow-wrap:anywhere}
.podaccess-row .pa-meta{color:var(--muted);font-size:10px;margin-top:3px}
@media(max-width:700px){.filter-row{gap:9px}.search{width:100%;flex:1}.showing-count{margin-left:0;width:100%}.dd-menu{min-width:170px}}
.dd-opt{white-space:nowrap}.dd-opt>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.dd-opt small{flex:0 0 auto;white-space:nowrap}
.site-row>*:not(:first-child){justify-self:end}
.site-link{background:none;border:0;padding:0;margin:0;font:inherit;color:#aebbd0;cursor:pointer}
.site-link:hover{text-decoration:underline;color:#dbe6f5}
.site-link.warn{color:var(--amber)}
.site-link.warn:hover{color:#ffcf7a}
.sites-tools{display:flex;align-items:center;gap:8px}
.sites-tools .search{width:150px}
</style>
</head>
<body data-api-base="__API_BASE__" data-csrf="__CSRF__" data-read-only="__READ_ONLY__">
<div id="previewRibbon" class="preview-ribbon hidden"><strong>UX preview</strong><span>Sample data · controls are simulated on this page</span></div>
<div class="wrap">
  <header class="topbar"><div class="brand"><span class="mark">p</span><span>Podbay relay</span></div><div class="header-right"><div class="header-state"><span id="stateDot" class="state-dot compact"></span><div class="header-state-copy"><b id="stateTitle">Relay connected</b><span id="stateDetail">Pods can use this connection</span></div></div><button class="btn danger" data-action="stop">Stop relay</button></div></header>
  <nav class="tabs-shell" aria-label="Relay dashboard sections"><div class="tab-list" role="tablist"><button id="tab-overview" class="tab" role="tab" aria-controls="panel-overview" aria-selected="true" data-tab="overview">Overview</button><button id="tab-live" class="tab" role="tab" aria-controls="panel-live" aria-selected="false" data-tab="live">Live <span id="liveBadge" class="tab-badge">0</span></button><button id="tab-events" class="tab" role="tab" aria-controls="panel-events" aria-selected="false" data-tab="events">Events <span id="eventsBadge" class="tab-badge attention-count">0</span></button><button id="tab-controls" class="tab" role="tab" aria-controls="panel-controls" aria-selected="false" data-tab="controls">Controls <span id="controlsBadge" class="tab-badge">0</span></button></div><label class="tab-range"><span>Range</span><span id="rangeMount"></span></label></nav>
  <main>
    <section id="panel-overview" class="tab-panel" role="tabpanel" aria-labelledby="tab-overview" data-tab-panel="overview"><section class="section" style="margin-top:22px"><div id="metrics" class="metrics"></div></section><section id="attentionSection" class="section"><div class="attention"><span class="attention-icon">!</span><div><h3 id="attentionTitle">3 events deserve a look</h3><p id="attentionCopy">A site refused a request, one connection failed, and a private-network target was safely blocked.</p></div><button class="btn" data-action="review-issues">Review events</button></div></section><section class="section"><div class="section-head"><div><h2>Usage over time</h2></div></div><div class="trend-panel"><div class="chart-wrap"><div id="chart" class="chart" aria-label="Relay activity by hour"></div><div id="chartTip" class="chart-tip" aria-hidden="true"></div><div id="chartAxis" class="chart-axis"></div></div><div class="trend-aside"><strong id="trendValue">—</strong><span id="trendLabel">versus the previous period</span></div></div></section><section class="section overview-glance"><div class="glance-panel"><div class="glance-head"><h3>Live now</h3><button class="btn ghost small" data-tab-jump="live">See live</button></div><div id="overviewLive" class="compact-list"></div></div><div class="glance-panel"><div class="glance-head"><h3>Recent events</h3><button class="btn ghost small" data-tab-jump="events">All events</button></div><div id="overviewEvents" class="compact-list"></div></div><div class="glance-panel"><div class="glance-head"><h3>Recent pods</h3><button class="btn ghost small" data-action="all-pods">Pod activity</button></div><div id="overviewPods" class="compact-list"></div></div></section></section>
    <section id="panel-live" class="tab-panel" role="tabpanel" aria-labelledby="tab-live" data-tab-panel="live" hidden><section class="section"><div id="live" class="live-list"></div></section></section>
    <section id="panel-events" class="tab-panel" role="tabpanel" aria-labelledby="tab-events" data-tab-panel="events" hidden><section class="section"><div class="section-head"><div><p id="activityCopy" class="section-kicker">A chronological local record · click a row for details</p></div><div class="subtabs" role="tablist" aria-label="Events view"><button class="subtab" role="tab" aria-selected="true" data-activity-view="events">Events</button><button class="subtab" role="tab" aria-selected="false" data-activity-view="sites">Sites</button></div></div><div id="eventsPane"><div class="filterbar"><div class="filter-row"><div class="filter-group"><span class="filter-label">Mode</span><div id="modeSeg" class="seg" role="group" aria-label="Filter by mode"></div></div><div class="filter-group"><span class="filter-label">Outcome</span><div id="outcomeChecks" class="checkrow" role="group" aria-label="Filter by outcome"></div></div><div class="filter-group"><span class="filter-label">Pod</span><span id="podMount"></span></div><div class="filter-group"><span class="filter-label">Site</span><input id="siteFilter" class="search" type="search" placeholder="any site" aria-label="Filter activity by site"></div></div><div class="filter-row"><div id="activeFilters" class="active-filters"></div><span id="showingCount" class="showing-count"></span></div></div><div id="events" class="events"></div><div id="loadMoreWrap" class="loadmore hidden"><button id="loadMore" type="button">Load more</button></div></div><div id="sitesPane" class="panel hidden"><div class="panel-title" style="display:flex;align-items:center;justify-content:space-between;gap:12px"><div><h3>Sites</h3><p>Domains this computer connected to in the selected range</p></div><div class="sites-tools"><input id="sitesSearch" class="search" type="search" placeholder="Filter domains" aria-label="Filter domains"><div id="sitesViewSeg" class="seg" role="group" aria-label="Filter sites"></div></div></div><div id="sites"></div></div></section></section>
    <section id="panel-controls" class="tab-panel" role="tabpanel" aria-labelledby="tab-controls" data-tab-panel="controls" hidden><div class="controls-layout"><aside class="control-hero"><h2>Your relay stays open by default</h2><p>Pods can reach the public web while the relay runs. These controls let you narrow that authority without maintaining an allowlist.</p><div class="control-rule"><i>IP</i><div><b>Private networks stay unreachable</b><span>Localhost, routers, NAS devices, and LAN targets are blocked independently.</span></div></div><div class="control-rule"><i>ID</i><div><b>Signed-in access is separate</b><span>Only sites you explicitly lend can use the relay's browser session.</span></div></div><div class="control-rule"><i>■</i><div><b>Stop is always global</b><span>The persistent header can cut off all relay traffic from any tab.</span></div></div><button class="btn ghost" data-action="copy-url">Copy local dashboard URL</button></aside><div class="panel controls-panel"><div class="panel-title"><h3>Relay access and history</h3><p>These settings live only on this computer</p></div><div class="setting"><div><b>Signed-in sites</b><p>Fetch may act as you on these sites</p></div><div id="signedSites" class="tag-list"></div></div><div class="setting"><div><b>Blocked sites</b><p>No pod can use your relay for these sites</p></div><div id="blockedSites" class="tag-list"></div></div><div class="setting" style="display:block"><div style="margin-bottom:2px"><b>Pod access</b><p>Pause any pod's use of your relay. A paused pod can't route until you resume it.</p></div></div><div id="podAccess"></div><div class="setting"><div><b>Keep activity</b><p id="storageCopy">30 days · 3.7 MB on disk</p></div><span id="retentionMount"></span></div><div class="setting"><div><b>Local history</b><p id="storagePath">~/.podbay/relay/events</p></div><div class="toolbar"><button class="btn small" data-action="export">Export</button><button class="btn small danger" data-action="clear-history">Clear</button></div></div></div></div><div class="footer-note controls-footer"><span>Full detail stays here. Podbay retains only coarse domain-level relay telemetry.</span><span>Queries, fragments, cookies, content, and credentials are never shown.</span></div></section>
  </main>
</div><div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>
const app={data:null,selectedPod:null,mode:'all',outcomes:new Set(),site:'',stopped:false,tab:'overview',activityView:'events',range:24,rangeLabel:'Last 24 hours',shown:50,openEvents:new Set(),sitesView:'all',sitesSearch:''};const PAGE_SIZE=50;const OUTCOME_GROUPS=[['ok','OK'],['refused','Refused'],['blocked','Blocked'],['error','Error']];const OUTCOME_PRED={ok:e=>e.outcome==='ok',refused:e=>e.outcome==='site-refused',blocked:e=>e.outcome==='owner-blocked'||e.outcome==='safety-blocked',error:e=>e.outcome==='network-error'||e.outcome==='rate-limited'};
const $=id=>document.getElementById(id);
const fmtBytes=n=>{n=Number(n)||0;if(!n)return'—';if(n>=1073741824){const g=n/1073741824;return(g>=10?g.toFixed(1):g.toFixed(2)).replace(/0+$/,'').replace(/\\.$/,'')+' GB'}if(n>=1048576){const m=n/1048576;return(m>=10?Math.round(m).toLocaleString():m.toFixed(1))+' MB'}if(n>=1024)return Math.round(n/1024).toLocaleString()+' KB';return n.toLocaleString()+' B'};
const fmtDuration=ms=>ms>=60000?Math.floor(ms/60000)+'m '+Math.floor(ms%60000/1000)+'s':ms>=1000?(ms/1000).toFixed(ms<10000?1:0)+'s':ms+'ms';
const timeAgo=iso=>{const s=Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/1000));if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';return Math.floor(s/3600)+'h ago'};
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node};
const podLabel=(name,id,fb)=>name||id||fb;
function toast(message){const t=$('toast');t.textContent=message;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2600)}
const apiBase=document.body.dataset.apiBase||'';const readOnly=document.body.dataset.readOnly==='true';
async function mutate(action,body={}){if(readOnly)throw new Error('Relay is stopped — controls are read only');const response=await fetch(apiBase+'/actions/'+action,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':document.body.dataset.csrf||''},body:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Action failed');await load();return data}
function activateTab(name,writeHash=true){const allowed=['overview','live','events','controls'];if(!allowed.includes(name))name='overview';app.tab=name;document.querySelectorAll('[data-tab]').forEach(tab=>{const active=tab.dataset.tab===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1});document.querySelectorAll('[data-tab-panel]').forEach(panel=>{panel.hidden=panel.dataset.tabPanel!==name});document.querySelector('.tab-range').classList.toggle('hidden',name==='controls');if(writeHash&&location.hash!=='#'+name)history.pushState(null,'','#'+name);window.scrollTo({top:0,behavior:'instant'})}
function activateActivityView(name){app.activityView=name;document.querySelectorAll('[data-activity-view]').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.activityView===name)));$('eventsPane').classList.toggle('hidden',name!=='events');$('sitesPane').classList.toggle('hidden',name!=='sites');$('activityCopy').textContent=name==='events'?scopedEvents().length+' events · detailed history stored locally':'Domain rollup for the selected time range'}
function inRange(event){return Date.now()-new Date(event.at).getTime()<=app.range*3600000}
function scopedEvents(){const gs=[...app.outcomes];return app.data.events.filter(e=>inRange(e)&&(!app.selectedPod||e.podId===app.selectedPod)&&(app.mode==='all'||e.mode===app.mode)&&(app.outcomes.size===0||gs.some(g=>OUTCOME_PRED[g](e)))&&(!app.site||e.host.toLowerCase().includes(app.site)))}
function allRangeEvents(){return app.data.events.filter(inRange)}
function renderState(){const state=app.stopped?'stopped':app.data.state;const title=state==='connected'?'Relay connected':state==='reconnecting'?'Relay reconnecting':'Relay stopped';$('stateTitle').textContent=title;$('stateDetail').textContent=state==='connected'?'Pods can use this connection':state==='reconnecting'?'Reconnecting — saved history remains available':'Showing saved history · updated '+timeAgo(app.data.updatedAt);$('stateDot').style.background=state==='connected'?'var(--green)':state==='reconnecting'?'var(--amber)':'var(--red)';const stop=document.querySelector('[data-action="stop"]');stop.textContent=state==='stopped'?'Relay stopped':'Stop relay';stop.disabled=state==='stopped';document.querySelector('[data-action="clear-history"]').disabled=readOnly}
function renderMetrics(){const rows=allRangeEvents();const fetches=rows.filter(e=>e.mode==='fetch'&&e.outcome==='ok').length;const conns=rows.filter(e=>e.mode==='tunnel'&&e.outcome==='ok').length;const data=rows.reduce((n,e)=>n+(e.bytesUp||0)+(e.bytesDown||0),0);const sessions=rows.filter(e=>e.session).length;const defs=[['Fetches',String(fetches),'completed page fetches',''],['Connections',String(conns),'completed live tunnels',''],['Data routed',fmtBytes(data),'tunnel traffic through this computer',''],['Signed-in fetches',String(sessions),'used a session you lent','session']];const root=$('metrics');root.replaceChildren();defs.forEach(d=>{const card=el('article','metric '+d[3]);const label=el('div','metric-label');label.append(el('span','',d[0]),el('span','metric-mark'));card.append(label,el('div','metric-value',d[1]),el('div','metric-foot',d[2]));root.append(card)})}
function renderAttention(){const rows=allRangeEvents().filter(e=>e.outcome!=='ok');$('attentionSection').classList.toggle('hidden',rows.length===0);$('attentionTitle').textContent=rows.length+' event'+(rows.length===1?'':'s')+' deserve a look';const labels=[...new Set(rows.map(e=>e.outcome==='site-refused'?'a site refusal':e.outcome==='safety-blocked'?'a safely blocked private target':e.outcome==='network-error'?'a connection error':e.outcome==='rate-limited'?'a rate limit':'an owner block'))];$('attentionCopy').textContent=labels.slice(0,3).join(', ').replace(/^./,c=>c.toUpperCase())+'.'}
function renderChart(){const root=$('chart');root.replaceChildren();const t=app.data.trend||[];const max=Math.max(...t,1);const peak=Math.max(...t,0);t.forEach((n,i)=>{const b=el('span','bar'+(n===peak&&peak>0?' peak':''));b.style.height=Math.max(4,n/max*100)+'%';const h=t.length-i;b.setAttribute('tabindex','0');b.setAttribute('aria-label',n+' events, '+h+' hours ago');b.addEventListener('mouseenter',()=>showChartTip(b,n,h));b.addEventListener('focus',()=>showChartTip(b,n,h));b.addEventListener('mouseleave',hideChartTip);b.addEventListener('blur',hideChartTip);root.append(b)});const axis=$('chartAxis');axis.replaceChildren();axis.append(el('span','','-'+t.length+'h'),el('span','','-'+Math.round(t.length/2)+'h'),el('span','','now'));const half=Math.floor(t.length/2)||1;const prior=t.slice(0,half).reduce((a,b)=>a+b,0);const recent=t.slice(t.length-half).reduce((a,b)=>a+b,0);let tv='—';if(prior>0){const pct=Math.round((recent-prior)/prior*100);tv=(pct>=0?'+':'')+pct+'%'}else if(recent>0){tv='New activity'}$('trendValue').textContent=tv;$('trendLabel').textContent='versus the previous period'}
function showChartTip(bar,n,h){const tip=$('chartTip');if(!tip)return;const wrap=bar.parentElement;const wr=wrap.getBoundingClientRect();const br=bar.getBoundingClientRect();tip.textContent=n+' event'+(n===1?'':'s')+' · '+(h<=1?'past hour':h+'h ago');tip.style.left=(br.left-wr.left+br.width/2)+'px';tip.style.top=(br.top-wr.top-8)+'px';tip.classList.add('show')}
function hideChartTip(){const tip=$('chartTip');if(tip)tip.classList.remove('show')}
function podRows(){const map=new Map();allRangeEvents().filter(e=>e.podId).forEach(e=>{const p=map.get(e.podId)||{id:e.podId,name:e.podName,fetch:0,tunnel:0,bytes:0,issues:0,session:0,last:e.at};if(!p.name&&e.podName)p.name=e.podName;p[e.mode]++;p.bytes+=(e.bytesUp||0)+(e.bytesDown||0);p.issues+=e.outcome==='ok'?0:1;p.session+=e.session?1:0;if(e.at>p.last)p.last=e.at;map.set(e.podId,p)});return[...map.values()].sort((a,b)=>b.last.localeCompare(a.last))}
function makeDropdown(mount,cfg){mount.classList.add('dropdown');mount.replaceChildren();const cur=cfg.options.find(o=>o.value===cfg.value)||cfg.options[0];const btn=el('button','dd-btn');btn.type='button';btn.setAttribute('aria-haspopup','listbox');btn.setAttribute('aria-expanded','false');const lbl=el('span','',cur?cur.label:'—');btn.append(lbl,el('span','caret','▾'));const menu=el('div','dd-menu');menu.setAttribute('role','listbox');if(cfg.ariaLabel)menu.setAttribute('aria-label',cfg.ariaLabel);menu.hidden=true;cfg.options.forEach(o=>{const it=el('button','dd-opt');it.type='button';it.setAttribute('role','option');it.setAttribute('aria-selected',String(o.value===cfg.value));it.append(el('span','',o.label),o.sub!==undefined?el('small','',o.sub):el('span','tick','✓'));it.addEventListener('click',ev=>{ev.stopPropagation();close();lbl.textContent=o.label;cfg.onSelect(o.value)});menu.append(it)});function open(){menu.hidden=false;btn.setAttribute('aria-expanded','true');setTimeout(()=>{document.addEventListener('click',outside);document.addEventListener('keydown',onkey)},0)}function close(){menu.hidden=true;btn.setAttribute('aria-expanded','false');document.removeEventListener('click',outside);document.removeEventListener('keydown',onkey)}function outside(e){if(!mount.contains(e.target))close()}function onkey(e){if(e.key==='Escape'){close();btn.focus()}}btn.addEventListener('click',ev=>{ev.stopPropagation();menu.hidden?open():close()});mount.append(btn,menu)}
function buildModeSeg(){const root=$('modeSeg');root.replaceChildren();[['all','All'],['fetch','Fetches'],['tunnel','Tunnels']].forEach(([v,l])=>{const b=el('button','',l);b.type='button';b.dataset.v=v;b.setAttribute('aria-pressed',String(app.mode===v));b.addEventListener('click',()=>{app.mode=v;app.shown=PAGE_SIZE;syncControls();renderActivity()});root.append(b)})}
function buildSitesSeg(){const root=$('sitesViewSeg');if(!root)return;root.replaceChildren();[['all','All'],['signed','Signed-in']].forEach(([v,l])=>{const b=el('button','',l);b.type='button';b.dataset.sv=v;b.setAttribute('aria-pressed',String(app.sitesView===v));b.addEventListener('click',()=>{app.sitesView=v;[...root.children].forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.sv===v)));renderSites()});root.append(b)})}
function buildOutcomeChecks(){const root=$('outcomeChecks');root.replaceChildren();OUTCOME_GROUPS.forEach(([k,l])=>{const b=el('button','check');b.type='button';b.dataset.k=k;b.setAttribute('aria-pressed',String(app.outcomes.has(k)));b.append(el('span','box'),el('span','',l));b.addEventListener('click',()=>{app.outcomes.has(k)?app.outcomes.delete(k):app.outcomes.add(k);app.shown=PAGE_SIZE;syncControls();renderActivity()});root.append(b)})}
function syncControls(){const ms=$('modeSeg');if(ms)[...ms.children].forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===app.mode)));const oc=$('outcomeChecks');if(oc)[...oc.children].forEach(b=>b.setAttribute('aria-pressed',String(app.outcomes.has(b.dataset.k))))}
function renderPodFilter(){const mount=$('podMount');if(!mount||mount.querySelector('.dd-menu:not([hidden])'))return;const pods=podRows();const opts=[{value:'',label:'All pods'}].concat(pods.map(p=>({value:p.id,label:podLabel(p.name,p.id),sub:(p.fetch+p.tunnel)+' ev'})));makeDropdown(mount,{ariaLabel:'Filter by pod',options:opts,value:app.selectedPod||'',onSelect:v=>{app.selectedPod=v||null;app.shown=PAGE_SIZE;renderAll()}})}
function renderActivity(){renderEvents();renderActiveFilters()}
function renderActiveFilters(){const root=$('activeFilters');if(!root)return;root.replaceChildren();const chips=[];if(app.mode!=='all')chips.push(['Mode',app.mode==='fetch'?'Fetches':'Tunnels',()=>{app.mode='all';app.shown=PAGE_SIZE;syncControls();renderAll()}]);[...app.outcomes].forEach(k=>{const l=(OUTCOME_GROUPS.find(g=>g[0]===k)||[])[1]||k;chips.push(['Outcome',l,()=>{app.outcomes.delete(k);app.shown=PAGE_SIZE;syncControls();renderAll()}])});if(app.selectedPod)chips.push(['Pod',app.selectedPod,()=>{app.selectedPod=null;app.shown=PAGE_SIZE;renderAll()}]);if(app.site)chips.push(['Site',app.site,()=>{app.site='';const s=$('siteFilter');if(s)s.value='';app.shown=PAGE_SIZE;renderAll()}]);chips.forEach(([k,v,clear])=>{const chip=el('span','filter-chip');chip.append(el('b','',k+': '),el('span','',v));const x=el('button','','×');x.type='button';x.setAttribute('aria-label','Remove '+k+' filter');x.addEventListener('click',clear);chip.append(x);root.append(chip)});if(chips.length>1){const clr=el('button','filter-chip','Clear all');clr.type='button';clr.style.paddingRight='10px';clr.addEventListener('click',()=>{app.mode='all';app.outcomes.clear();app.selectedPod=null;app.site='';const s=$('siteFilter');if(s)s.value='';app.shown=PAGE_SIZE;syncControls();renderAll()});root.append(clr)}}
function renderPodAccess(){const root=$('podAccess');if(!root)return;root.replaceChildren();const pods=podRows();const seen=new Set();pods.forEach(p=>{seen.add(p.id);addPodAccessRow(root,p.id,p.name,app.data.pausedPods.includes(p.id),p.fetch+' fetches · '+p.tunnel+' tunnels · '+fmtBytes(p.bytes))});app.data.pausedPods.forEach(id=>{if(!seen.has(id))addPodAccessRow(root,id,null,true,'paused · no recent activity')});if(!root.children.length)root.append(el('div','empty','No pods have used your relay in this range.'))}
function addPodAccessRow(root,id,name,paused,meta){const row=el('div','podaccess-row');const info=el('div');info.append(el('div','pa-name',podLabel(name,id)),el('div','pa-meta',meta));const status=el('span','pod-risk'+(paused?' warn':''),paused?'Paused':'Active');const btn=el('button','btn small'+(paused?' danger':''),paused?'Resume':'Pause');btn.disabled=readOnly;btn.addEventListener('click',async()=>{if(!confirm((paused?'Resume ':'Pause ')+podLabel(name,id)+' relay access?'))return;try{await mutate('pod',{podId:id,paused:!paused});toast((paused?'Resumed ':'Paused ')+podLabel(name,id))}catch(error){toast(error.message)}});row.append(info,status,btn);root.append(row)}
function renderLiveInto(root,compact=false){root.replaceChildren();const rows=app.data.active.filter(x=>!app.selectedPod||x.podId===app.selectedPod);rows.slice(0,compact?3:rows.length).forEach(x=>{if(compact){const row=el('div','compact-row');const copy=el('div');copy.append(el('strong','',x.target),el('span','',podLabel(x.podName,x.podId,'System health check')+' · '+(x.mode==='tunnel'?'streaming':'fetching')));row.append(copy,el('span','compact-value',fmtDuration(Date.now()-new Date(x.startedAt).getTime())));root.append(row);return}const row=el('div','live-row');row.append(el('span','pulse',x.mode==='tunnel'?'Streaming':'Fetching'));const target=el('div','target');target.append(el('strong','',x.target),el('span','',podLabel(x.podName,x.podId,'System health check')));const dur=el('div','live-meta');dur.append(el('b','',fmtDuration(Date.now()-new Date(x.startedAt).getTime())),el('span','','elapsed'));const bytes=el('div','live-meta');bytes.append(el('b','',x.mode==='tunnel'?fmtBytes((x.bytesUp||0)+(x.bytesDown||0)):'Waiting for page'),el('span','',x.mode==='tunnel'?'↑ '+fmtBytes(x.bytesUp)+' · ↓ '+fmtBytes(x.bytesDown):'browser fetch'));row.append(target,dur,bytes);root.append(row)});if(!rows.length)root.append(el('div','empty','Nothing is using this connection right now.'))}
function renderLive(){renderLiveInto($('live'));renderLiveInto($('overviewLive'),true)}
function renderOverviewPods(){const root=$('overviewPods');root.replaceChildren();const rows=podRows();rows.slice(0,3).forEach(p=>{const row=el('button','compact-row');row.style.width='100%';row.style.border='0';row.style.borderBottom='1px solid var(--line)';row.style.background='transparent';row.style.color='inherit';row.style.textAlign='left';const copy=el('div');copy.append(el('strong','',podLabel(p.name,p.id)),el('span','',p.fetch+' fetches · '+p.tunnel+' tunnels · last used '+timeAgo(p.last)));row.append(copy,el('span','compact-value',p.issues?p.issues+' issues':'Healthy'));row.addEventListener('click',()=>{app.selectedPod=p.id;app.shown=PAGE_SIZE;activateTab('events');renderAll()});root.append(row)});if(!rows.length)root.append(el('div','empty','No pod activity in this range.'))}
function renderOverviewEvents(){const root=$('overviewEvents');if(!root)return;root.replaceChildren();const rows=allRangeEvents().slice(0,3);rows.forEach(e=>{const row=el('button','compact-row');row.style.width='100%';row.style.border='0';row.style.borderBottom='1px solid var(--line)';row.style.background='transparent';row.style.color='inherit';row.style.textAlign='left';const copy=el('div');copy.append(el('strong','',e.host),el('span','',podLabel(e.podName,e.podId,'Unknown pod')+' · '+outcomeLabel(e.outcome)+' · '+timeAgo(e.at)));row.append(copy,el('span','compact-value',e.mode==='tunnel'?fmtBytes((e.bytesUp||0)+(e.bytesDown||0)):(e.status?'HTTP '+e.status:'—')));row.addEventListener('click',()=>{activateTab('events')});root.append(row)});if(!rows.length)root.append(el('div','empty','No events in this range.'))}
function outcomeLabel(value){return value.split('-').join(' ')}
function renderEvents(){const root=$('events');root.replaceChildren();const rows=scopedEvents();if(!rows.length){root.append(el('div','empty','No activity matches these filters.'));$('loadMoreWrap').classList.add('hidden');$('showingCount').textContent='No events';if(app.activityView==='events')$('activityCopy').textContent='No events match these filters';return}const head=el('div','events-head');['Time','Pod','Mode','Target','Outcome','Data'].forEach(x=>head.append(el('span','',x)));root.append(head);rows.slice(0,app.shown).forEach(e=>{const row=el('article','event'+(app.openEvents.has(e.id)?' open':''));row.tabIndex=0;row.setAttribute('aria-label',e.mode+' to '+e.host+', '+outcomeLabel(e.outcome));row.append(el('span','event-time',timeAgo(e.at)),el('span','pod-chip',podLabel(e.podName,e.podId,'Unknown pod')),el('span','mode-chip '+e.mode,e.mode));const target=el('div','target');target.append(el('strong','',e.target),el('span','',e.status?'HTTP '+e.status:'No HTTP status'));row.append(target);const outcomeClass=e.outcome==='ok'?'outcome':e.outcome.includes('blocked')?'outcome blocked':'outcome bad';row.append(el('span',outcomeClass,outcomeLabel(e.outcome)),el('span','bytes',e.mode==='tunnel'?fmtBytes((e.bytesUp||0)+(e.bytesDown||0)):'—'));const detail=el('div','event-detail');[['Started',new Date(e.at).toLocaleString()],['Duration',fmtDuration(e.ms)],['Session',e.session?'Signed in as you':'Clean / no cookies'],['Reason',e.reason||'Completed normally']].forEach(x=>{const item=el('div','detail-item');item.append(el('b','',x[0]),el('span','',x[1]));detail.append(item)});row.append(detail);const toggle=()=>{if(app.openEvents.has(e.id)){app.openEvents.delete(e.id);row.classList.remove('open')}else{app.openEvents.add(e.id);row.classList.add('open')}};row.addEventListener('click',toggle);row.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();toggle()}});root.append(row)});const more=rows.length>app.shown;$('loadMoreWrap').classList.toggle('hidden',!more);if(more)$('loadMore').textContent='Load '+Math.min(PAGE_SIZE,rows.length-app.shown)+' more';$('showingCount').textContent='Showing '+Math.min(app.shown,rows.length)+' of '+rows.length+' event'+(rows.length===1?'':'s');if(app.activityView==='events')$('activityCopy').textContent=rows.length+' event'+(rows.length===1?'':'s')+(app.selectedPod?' from '+app.selectedPod:'')+' · detailed history stored locally'}
function eventsForSite(host,issuesOnly){app.site=host;const sf=$('siteFilter');if(sf)sf.value=host;app.outcomes=issuesOnly?new Set(['refused','blocked','error']):new Set();app.mode='all';app.selectedPod=null;app.shown=PAGE_SIZE;syncControls();activateActivityView('events');activateTab('events');renderAll()}
function renderSites(){const root=$('sites');if(!root)return;root.replaceChildren();const map=new Map();allRangeEvents().forEach(e=>{const s=map.get(e.host)||{host:e.host,count:0,issues:0,bytes:0,session:0};s.count++;s.issues+=e.outcome==='ok'?0:1;s.bytes+=(e.bytesUp||0)+(e.bytesDown||0);s.session+=e.session?1:0;map.set(e.host,s)});const q=app.sitesSearch;const list=[...map.values()].filter(s=>(app.sitesView!=='signed'||s.session>0)&&(!q||s.host.toLowerCase().includes(q))).sort((a,b)=>b.count-a.count).slice(0,200);if(!list.length){root.append(el('div','empty',q?'No domains match "'+q+'".':app.sitesView==='signed'?'No signed-in sites in this range.':'No site activity in this range.'));return}list.forEach(s=>{const row=el('div','site-row');const blocked=app.data.blockedSites.includes(s.host);const control=el('button','btn small'+(blocked?' danger':''),blocked?'Unblock':'Block');control.disabled=readOnly;control.addEventListener('click',async()=>{if(!confirm((blocked?'Unblock ':'Block ')+s.host+(blocked?'?':' for every pod?')))return;try{await mutate('site',{domain:s.host,blocked:!blocked});toast((blocked?'Unblocked ':'Blocked ')+s.host)}catch(error){toast(error.message)}});const ev=el('button','site-link',s.count+' event'+(s.count===1?'':'s'));ev.type='button';ev.title='View these events';ev.addEventListener('click',()=>eventsForSite(s.host,false));let iss;if(s.issues){iss=el('button','site-link warn',s.issues+' issue'+(s.issues===1?'':'s'));iss.type='button';iss.title='View issues for this site';iss.addEventListener('click',()=>eventsForSite(s.host,true))}else{iss=el('span','','Healthy')}row.append(el('b','',s.host),ev,iss,control);root.append(row)})}
function renderSettings(){const signed=$('signedSites');signed.replaceChildren();app.data.signedInSites.forEach(s=>{const b=el('button','tag signed',s+' ×');b.disabled=readOnly;b.title='Revoke signed-in use for '+s;b.addEventListener('click',async()=>{if(!confirm('Revoke signed-in access for '+s+'? Clean access will remain available.'))return;try{await mutate('revoke-session',{domain:s});toast('Revoked signed-in access for '+s)}catch(error){toast(error.message)}});signed.append(b)});if(!signed.children.length)signed.append(el('span','tag','None'));const blocked=$('blockedSites');blocked.replaceChildren();app.data.blockedSites.forEach(s=>{const b=el('button','tag blocked',s+' ×');b.disabled=readOnly;b.title='Unblock '+s;b.addEventListener('click',async()=>{try{await mutate('site',{domain:s,blocked:false});toast('Unblocked '+s)}catch(error){toast(error.message)}});blocked.append(b)});if(!blocked.children.length)blocked.append(el('span','tag','None'));if(!$('retentionMount').querySelector('.dd-menu:not([hidden])'))makeDropdown($('retentionMount'),{ariaLabel:'History retention',options:[{value:7,label:'7 days'},{value:30,label:'30 days'},{value:90,label:'90 days'}],value:app.data.retentionDays,onSelect:async v=>{if(readOnly)return;try{await mutate('retention',{days:Number(v)});toast('Keeping '+v+' days of activity')}catch(error){toast(error.message)}}});$('storageCopy').textContent=app.data.retentionDays+' days · '+fmtBytes(app.data.storageBytes)+' on disk';$('storagePath').textContent=app.data.storagePath}
function renderBadges(){const issues=allRangeEvents().filter(e=>e.outcome!=='ok').length;$('eventsBadge').textContent=String(issues);$('eventsBadge').classList.toggle('hidden',issues===0);const live=app.data.active?app.data.active.length:0;$('liveBadge').textContent=String(live);$('liveBadge').classList.toggle('hidden',live===0);const controls=app.data.blockedSites.length+app.data.pausedPods.length;$('controlsBadge').textContent=String(controls);$('controlsBadge').classList.toggle('hidden',controls===0)}
function renderAll(){renderState();renderMetrics();renderAttention();renderChart();renderOverviewPods();renderOverviewEvents();renderLive();renderPodFilter();syncControls();renderEvents();renderActiveFilters();renderSites();renderSettings();renderPodAccess();renderBadges();activateActivityView(app.activityView)}
async function refresh(){app.data=await fetch(apiBase+'/data').then(r=>r.json());$('previewRibbon').classList.toggle('hidden',!app.data.preview);renderAll()}
async function load(){await refresh();activateTab(location.hash.slice(1)||'overview',false)}
buildModeSeg();buildOutcomeChecks();buildSitesSeg();makeDropdown($('rangeMount'),{ariaLabel:'Time range',options:[{value:24,label:'Last 24 hours'},{value:6,label:'Last 6 hours'},{value:1,label:'Last hour'}],value:app.range,onSelect:v=>{app.range=Number(v);app.rangeLabel=v===24?'Last 24 hours':v===6?'Last 6 hours':'Last hour';app.shown=PAGE_SIZE;renderAll()}});$('siteFilter').addEventListener('input',e=>{app.site=e.target.value.trim().toLowerCase();app.shown=PAGE_SIZE;renderActivity()});$('loadMore').addEventListener('click',()=>{app.shown+=PAGE_SIZE;renderEvents()});$('sitesSearch').addEventListener('input',e=>{app.sitesSearch=e.target.value.trim().toLowerCase();renderSites()});
document.addEventListener('click',async e=>{const tab=e.target.closest('[data-tab]');if(tab){activateTab(tab.dataset.tab);return}const jump=e.target.closest('[data-tab-jump]');if(jump){activateTab(jump.dataset.tabJump);return}const activityView=e.target.closest('[data-activity-view]');if(activityView){activateActivityView(activityView.dataset.activityView);return}const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;if(action==='review-issues'){app.outcomes=new Set(['refused','blocked','error']);app.mode='all';app.shown=PAGE_SIZE;syncControls();activateActivityView('events');activateTab('events');renderAll()}if(action==='all-pods'){app.selectedPod=null;app.shown=PAGE_SIZE;activateActivityView('events');activateTab('events');renderAll()}if(action==='stop'&&confirm('Stop the relay for every pod? Saved history will remain available.')){try{await mutate('stop');app.stopped=true;renderState();toast('Relay stopping')}catch(error){toast(error.message)}}if(action==='copy-url'){navigator.clipboard?.writeText(location.href);toast('Local URL copied')}if(action==='export'){location.href=apiBase+'/export'}if(action==='clear-history'&&confirm('Clear all retained relay activity? Pairing, sessions, and access rules will stay unchanged.')){try{await mutate('clear-history');toast('Local relay history cleared')}catch(error){toast(error.message)}}});
document.querySelector('.tab-list').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tabs=[...document.querySelectorAll('[data-tab]')];let index=tabs.indexOf(document.activeElement);if(e.key==='Home')index=0;else if(e.key==='End')index=tabs.length-1;else index=(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;e.preventDefault();tabs[index].focus();activateTab(tabs[index].dataset.tab)});
window.addEventListener('popstate',()=>activateTab(location.hash.slice(1)||'overview',false));
load();setInterval(()=>{if(app.data)refresh().catch(()=>undefined)},2000);
</script>
</body></html>`;

export interface DashboardActions {
  stop?(): void | Promise<void>;
  revokeSession?(domain: string): void | Promise<void>;
}

export interface DashboardOptions {
  preview?: boolean;
  fixture?: DashboardFixture;
  readOnly?: boolean;
  store?: RelayEventStore;
  runtime?: RelayRuntime;
  config?: () => RelayConfig;
  actions?: DashboardActions;
  routeToken?: string;
  csrfToken?: string;
}

function pageFor(base: string, csrf: string, readOnly: boolean): string {
  return PAGE
    .replace("__API_BASE__", base)
    .replace("__CSRF__", csrf)
    .replace("__READ_ONLY__", String(readOnly));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16_384) { reject(new Error("request too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>); }
      catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function response(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

export function serveDashboard(
  port = 7373,
  options: DashboardOptions = {},
): Promise<{ url: string; close: () => void; routeToken: string; csrfToken: string }> {
  return new Promise((resolve, reject) => {
    const routeToken = options.routeToken ?? randomBytes(32).toString("hex");
    const csrfToken = options.csrfToken ?? randomBytes(32).toString("hex");
    const base = options.preview ? "" : `/${routeToken}`;
    const store = options.store ?? (options.preview ? undefined : new LocalEventStore({ retentionDays: load().retentionDays }).init());
    const runtime = options.runtime ?? new RelayRuntime({ daemon: "stopped" });
    const config = options.config ?? load;
    const readOnly = options.readOnly ?? (!options.preview && runtime.snapshot().daemon === "stopped");
    let origin = "";
    const server = createServer((req, res) => {
      void (async () => {
        try {
          const host = req.headers.host ?? "";
          const expectedPort = new URL(origin || "http://127.0.0.1").port;
          const allowedHosts = new Set([`127.0.0.1:${expectedPort}`, `localhost:${expectedPort}`, `[::1]:${expectedPort}`]);
          if (origin && !allowedHosts.has(host)) return response(res, 400, { error: "unexpected Host" });
          const pathname = new URL(req.url ?? "/", origin || "http://127.0.0.1").pathname.replace(/\/$/, "") || "/";
          if (pathname === `${base}/data`) {
            return json(res, options.preview ? fixtureData(options.fixture ?? "active") : currentData(store!, runtime.snapshot(), config()));
          }
          if (pathname === `${base}/export` && req.method === "GET") {
            res.writeHead(200, {
              ...SECURITY_HEADERS,
              "cache-control": "no-store",
              "content-type": "application/json; charset=utf-8",
              "content-disposition": `attachment; filename="podbay-relay-events-${new Date().toISOString().slice(0, 10)}.json"`,
            });
            res.end(options.preview ? JSON.stringify(fixtureData(options.fixture ?? "active").events, null, 2) : store!.exportJson());
            return;
          }
          if (pathname.startsWith(`${base}/actions/`)) {
            if (readOnly) return response(res, 404, { error: "controls are unavailable while the relay is stopped" });
            if (req.method !== "POST") return response(res, 405, { error: "POST required" });
            if (req.headers["content-type"] !== "application/json") return response(res, 415, { error: "application/json required" });
            if (req.headers.origin !== origin) return response(res, 403, { error: "same-origin request required" });
            if (req.headers["x-csrf-token"] !== csrfToken) return response(res, 403, { error: "invalid CSRF token" });
            const body = await readJson(req);
            const action = pathname.slice(`${base}/actions/`.length);
            if (options.preview) {
              return response(res, 200, { ok: true, simulated: true });
            } else if (action === "pod" && typeof body.podId === "string" && typeof body.paused === "boolean") {
              setPodPaused(body.podId, body.paused);
            } else if (action === "site" && typeof body.domain === "string" && typeof body.blocked === "boolean") {
              setDomainBlocked(body.domain, body.blocked);
            } else if (action === "retention" && typeof body.days === "number") {
              setRetentionDays(body.days);
              store!.setRetentionDays(body.days as 7 | 30 | 90);
              store!.prune(true);
              store!.reload();
            } else if (action === "clear-history") {
              store!.clear();
            } else if (action === "revoke-session" && typeof body.domain === "string" && options.actions?.revokeSession) {
              await options.actions.revokeSession(body.domain);
            } else if (action === "stop" && options.actions?.stop) {
              await options.actions.stop();
            } else {
              return response(res, 400, { error: "invalid action or body" });
            }
            return response(res, 200, { ok: true });
          }
          if (pathname !== (base || "/")) return response(res, 404, { error: "not found" });
          res.writeHead(200, { ...SECURITY_HEADERS, "cache-control": "no-store", "content-type": "text/html; charset=utf-8" });
          res.end(pageFor(base, csrfToken, readOnly));
        } catch (error) {
          if (!res.headersSent) response(res, 500, { error: "dashboard request failed" });
          else res.end();
        }
      })();
    });
    let retried = false;
    const listen = (candidate: number) => server.listen(candidate, "127.0.0.1");
    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" && !retried && port !== 0) {
        retried = true;
        server.close(() => listen(0));
        return;
      }
      reject(error);
    });
    server.on("listening", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      origin = `http://127.0.0.1:${actualPort}`;
      resolve({ url: `${origin}${base || ""}`, close: () => server.close(), routeToken, csrfToken });
    });
    listen(port);
  });
}
