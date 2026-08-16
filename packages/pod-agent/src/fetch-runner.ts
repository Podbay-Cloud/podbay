import { execFile } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { climb, type Fetcher, type FetchPlanView, type LadderResult } from "./fetch-ladder.js";
import type { FetchRung } from "@podbay/shared";

/**
 * The IO half of the ladder — deliberately thin, because every decision lives in
 * fetch-ladder.ts where it can be tested without a network.
 */

const PLAN_PATH = process.env.PODBAY_FETCH_PLAN ?? "/etc/podbay/fetch-memory.json";
const REPORTS_PATH =
  process.env.PODBAY_FETCH_REPORTS ?? "/home/dev/.podbay-fetch-reports.jsonl";
const RENDER_TIMEOUT_MS = 45_000;

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.split(/[/?#]/)[0]!.replace(/^www\./, "").toLowerCase();
  }
}

/** Read what the control plane last pushed. Absent or unreadable is normal on a fresh
 * pod and means "climb as usual" — never an error. */
export function readPlan(domain: string): FetchPlanView {
  try {
    const all = JSON.parse(readFileSync(PLAN_PATH, "utf8")) as {
      domains?: Record<string, FetchPlanView>;
    };
    const p = all.domains?.[domain];
    return { good: p?.good ?? [], bad: p?.bad ?? [] };
  } catch {
    return { good: [], bad: [] };
  }
}

/** Buffer outcomes for the control plane to drain on its next poll. Best-effort: a
 * failure to record must never fail the fetch the caller asked for. */
export function writeReports(
  domain: string,
  reports: { rung: FetchRung; outcome: string }[],
): void {
  const at = new Date().toISOString();
  try {
    for (const r of reports) {
      // A `timeout` is TRANSIENT (a slow/hung transport), never a durable verdict — and
      // the shared-memory store rejects it anyway. Buffering it would earn nothing but a
      // `fetch_outcome_rejected` log on every relay hiccup. Recording a transient failure
      // as durable is the exact mistake that once silently killed the relay for a domain
      // the owner had just logged into — so it stops here.
      if (r.outcome === "timeout") continue;
      appendFileSync(REPORTS_PATH, JSON.stringify({ domain, ...r, at }) + "\n");
    }
  } catch {
    /* best-effort by design */
  }
}

/**
 * Render with the prebaked browser, honest identity.
 *
 * Shells to Python because the pod ships Playwright for Python, not for Node. The
 * script sets no user-agent, no stealth flags and no automation-hiding — see the
 * no-stealth guard in @podbay/shared's tests for why that is a boundary and not an
 * oversight.
 */
const RENDER_PY = `
import json, sys, time
from playwright.sync_api import sync_playwright
url = sys.argv[1]

# Wait for CONTENT, not for a clock. A fixed sleep is a guess that is simultaneously
# too long for fast pages and too short for slow ones — measured: a 2.5s wait made
# excalidraw.com look empty and fall through to a reader service, when the browser was
# the right rung and only needed another second. Poll until the text stops growing.
def settle(pg, floor=200, limit_ms=12000, quiet_ms=700):
    start = time.time() * 1000
    last, stable_since = -1, None
    while (time.time() * 1000) - start < limit_ms:
        try:
            n = len(pg.inner_text("body"))
        except Exception:
            n = 0
        if n == last:
            if stable_since is None:
                stable_since = time.time() * 1000
            elif (time.time() * 1000) - stable_since >= quiet_ms and n >= floor:
                return
        else:
            last, stable_since = n, None
        pg.wait_for_timeout(200)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    try:
        r = pg.goto(url, wait_until="domcontentloaded", timeout=35000)
        settle(pg)
        print(json.dumps({"status": r.status if r else 0, "body": pg.content(), "finalUrl": pg.url}))
    finally:
        b.close()
`;

function renderWithBrowser(url: string): Promise<{ status: number; body: string; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "python3",
      ["-c", RENDER_PY, url],
      { timeout: RENDER_TIMEOUT_MS, maxBuffer: 20_000_000 },
      (err, stdout) => {
        if (err && !stdout) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

async function plainFetch(url: string): Promise<{ status: number; body: string; contentType?: string; finalUrl: string }> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25_000) });
  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get("content-type") ?? undefined,
    finalUrl: res.url,
  };
}

/** Run the ladder for one URL, consulting and updating the fleet's memory. The relay
 * rung is present only when the owner's relay is connected — otherwise the ladder
 * simply doesn't have that rung and reports it needs one. */
export async function runFetch(
  url: string,
  wanted?: string[],
  opts: { relayFetch?: (url: string) => Promise<{ status: number; body: string; finalUrl?: string }> } = {},
): Promise<LadderResult & { domain: string }> {
  const domain = domainOf(url);
  const fetchers: Partial<Record<FetchRung, Fetcher>> = {
    direct: () => plainFetch(url),
    browser: () => renderWithBrowser(url),
    // Reader services are a CANDIDATE, not a tier: capped, and they return block
    // pages with a 200. The verifier judges this one like any other rung.
    reader: () => plainFetch(`https://r.jina.ai/${url}`),
    ...(opts.relayFetch
      ? {
          // The relay fetches from the OWNER's residential IP, the only rung that
          // changes network origin — the last resort for an IP-refused source.
          relay: async () => {
            const r = await opts.relayFetch!(url);
            return { status: r.status, body: r.body, finalUrl: r.finalUrl };
          },
        }
      : {}),
  };
  const result = await climb({ url, plan: readPlan(domain), fetchers, wanted });
  writeReports(domain, result.reports);
  return { ...result, domain };
}
