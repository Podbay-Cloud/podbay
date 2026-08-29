import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@podbay/shared/log";

const execFileP = promisify(execFile);
const log = createLogger("preview-shot");

/**
 * Self-screenshot of the pod's own preview app (localhost:3000), so the cockpit shows a lightweight
 * THUMBNAIL instead of framing the whole live site in a heavy iframe (owner decision, 2026-08-26).
 *
 * The key simplification vs. a central screenshotter: the pod snapshots ITSELF over loopback using the
 * image's PREBAKED headless Chromium (`chrome-headless-shell` under $PLAYWRIGHT_BROWSERS_PATH) — no
 * external service, no datacenter-egress problem, no queue. We spawn the binary with its built-in
 * `--screenshot` flag rather than pulling in Playwright as a dependency (the pod-agent is a single
 * bundled file; the binary + `--screenshot` is all we need).
 *
 * A short in-memory cache + single-flight coalescing means the cockpit can poll freely: it gets the
 * last shot instantly and a fresh capture is taken at most once per `maxAgeMs`.
 */

/** Locate the prebaked chrome-headless-shell, version-independently (the `-<rev>` bumps with the image). */
function findShellBinary(): string | null {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/ms-playwright";
  try {
    // Newest revision first, so a version bump is picked up without code changes.
    const dirs = readdirSync(root)
      .filter((d) => d.startsWith("chromium_headless_shell-"))
      .sort()
      .reverse();
    for (const d of dirs) {
      const bin = join(root, d, "chrome-headless-shell-linux64", "chrome-headless-shell");
      if (existsSync(bin)) return bin;
    }
  } catch {
    // root missing / unreadable — fall through to null (feature just stays unavailable)
  }
  return null;
}

export interface PreviewShotterOpts {
  /** The preview port to screenshot (loopback). Default 3000. */
  port?: number;
  /** Serve a cached shot without recapturing if it is younger than this. Default 30s. */
  maxAgeMs?: number;
  /** Viewport (and thus image) size. A modest thumbnail — the cockpit scales it down further. */
  width?: number;
  height?: number;
}

export class PreviewShotter {
  private cache: { at: number; buf: Buffer } | null = null;
  private inflight: Promise<Buffer | null> | null = null;
  private readonly port: number;
  private readonly maxAgeMs: number;
  private readonly width: number;
  private readonly height: number;

  constructor(opts: PreviewShotterOpts = {}) {
    this.port = opts.port ?? 3000;
    this.maxAgeMs = opts.maxAgeMs ?? 30_000;
    this.width = opts.width ?? 1200;
    this.height = opts.height ?? 750;
  }

  /** Latest thumbnail PNG. Returns the cache when fresh, otherwise captures once (coalescing concurrent
   * callers). Returns null if capture isn't possible (no binary) and nothing is cached. */
  async get(): Promise<Buffer | null> {
    if (this.cache && Date.now() - this.cache.at < this.maxAgeMs) return this.cache.buf;
    if (this.inflight) return this.inflight;
    this.inflight = this.capture().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async capture(): Promise<Buffer | null> {
    const bin = findShellBinary();
    if (!bin) {
      log.warn("no_chromium_shell", { root: process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/ms-playwright" });
      return this.cache?.buf ?? null;
    }
    const dir = await mkdtemp(join(tmpdir(), "pshot-"));
    const out = join(dir, "shot.png");
    try {
      await execFileP(
        bin,
        [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage", // pods have a small /dev/shm; without this Chromium can crash
          "--hide-scrollbars",
          `--window-size=${this.width},${this.height}`,
          `--screenshot=${out}`,
          `http://localhost:${this.port}/`,
        ],
        { timeout: 20_000, maxBuffer: 1 << 20 },
      );
      const buf = await readFile(out);
      this.cache = { at: Date.now(), buf };
      log.info("captured", { bytes: buf.length, port: this.port });
      return buf;
    } catch (e) {
      // Serve the last good shot on a transient failure rather than a broken image.
      log.warn("capture_failed", { err: e instanceof Error ? e.message : String(e) });
      return this.cache?.buf ?? null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Exposed for a unit test that drives the real binary against a throwaway local server. */
export const _internal = { findShellBinary };
