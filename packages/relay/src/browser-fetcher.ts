import type { FetchJob, FetchOutput, Fetcher } from "./relay-client.js";

/**
 * Fetch a page on the OWNER's machine, choosing the session per the login policy.
 *
 *  - A host the owner explicitly signed into (`isSessionDomain`) is fetched in the
 *    PERSISTENT profile — as them, with their cookies. That is the deliberate,
 *    opt-in "fetch as me".
 *  - Every other host is fetched in a fresh EPHEMERAL context with no cookies — the
 *    residential IP, but not the owner's accounts. So a prompt-injected pod fetching
 *    gmail.com gets a logged-out page, not the owner's inbox.
 *
 * Both contexts: one page per request, always closed; warm and recycled after N pages;
 * scrape and return bytes, never an eval channel or a live handle.
 */
export interface BrowserOptions {
  profileDir: string;
  channel?: string;
  navTimeoutMs?: number;
  /** Hard ceiling on a WHOLE fetch (launch + nav + read). A browser that stalls past
   * this is aborted and torn down so it can't hang the relay — see `fetch`. */
  fetchDeadlineMs?: number;
  recycleAfter?: number;
  headless?: boolean;
  /** Does this host use the owner's signed-in session? Read from config per fetch. */
  isSessionDomain: (host: string) => boolean;
}

interface Page {
  goto(url: string, o: { waitUntil: string; timeout: number }): Promise<{ status(): number } | null>;
  content(): Promise<string>;
  url(): string;
  waitForTimeout(ms: number): Promise<void>;
  close(): Promise<void>;
}
interface Context {
  newPage(): Promise<Page>;
  close(): Promise<void>;
  clearCookies(options?: { domain?: string | RegExp }): Promise<void>;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export class BrowserFetcher {
  private browser: { newContext(o?: Record<string, unknown>): Promise<Context> } | null = null;
  private session: Context | null = null; // persistent profile (login domains)
  private served = 0;

  constructor(private readonly opts: BrowserOptions) {}

  private async pw() {
    return (await import("playwright").catch(() => {
      throw new Error("Playwright missing. The relay bundles it; reinstall: npx @podbay/relay@latest");
    })) as typeof import("playwright");
  }

  /**
   * Launch, preferring the owner's installed Chrome (no download) and falling back to
   * Playwright's bundled Chromium. A missing browser entirely is a clear, actionable
   * error, not a stack trace.
   */
  private async launch<T>(fn: (o: Record<string, unknown>) => Promise<T>): Promise<T> {
    const base = { headless: this.opts.headless ?? true, viewport: { width: 1440, height: 900 } };
    try {
      return await fn({ ...base, channel: this.opts.channel ?? "chrome" });
    } catch {
      try {
        return await fn(base); // bundled chromium
      } catch (e) {
        throw new Error(
          `no browser found. Install one for the relay: npx playwright install chromium  (${String(e).slice(0, 80)})`,
        );
      }
    }
  }

  private async sessionCtx(): Promise<Context> {
    if (this.session) return this.session;
    const pw = await this.pw();
    this.session = (await this.launch((o) =>
      pw.chromium.launchPersistentContext(this.opts.profileDir, o),
    )) as unknown as Context;
    return this.session;
  }

  private async cleanCtx(): Promise<Context> {
    if (!this.browser) {
      const pw = await this.pw();
      this.browser = (await this.launch((o) => pw.chromium.launch(o))) as unknown as {
        newContext(o?: Record<string, unknown>): Promise<Context>;
      };
    }
    return this.browser.newContext({ viewport: { width: 1440, height: 900 } });
  }

  /**
   * WATCHDOG: a fetch that stalls (a site refusing a headless browser, a hung context,
   * a wedged persistent profile) must NEVER hang the relay — that was the whole
   * "relay running but nothing comes back" failure (live-caught on reddit, 2026-08-03).
   * The nav timeout only bounds `goto`; launch, `content()`, and context creation could
   * hang unbounded. So the whole fetch races a hard deadline, and on a blown deadline we
   * TEAR DOWN the browser so the NEXT fetch relaunches clean rather than inheriting a
   * wedged one.
   */
  readonly fetch: Fetcher = async (job: FetchJob): Promise<FetchOutput> => {
    const host = hostOf(job.url);
    const useSession = this.opts.isSessionDomain(host);
    const deadlineMs = this.opts.fetchDeadlineMs ?? 25_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`relay fetch timed out after ${deadlineMs}ms`)), deadlineMs);
    });
    try {
      return await Promise.race([this.doFetch(job, useSession), deadline]);
    } catch (e) {
      await this.resetBrowser(useSession); // a hung/errored browser must not poison the next fetch
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  private async doFetch(job: FetchJob, useSession: boolean): Promise<FetchOutput> {
    const ctx = useSession ? await this.sessionCtx() : await this.cleanCtx();
    const page = await ctx.newPage();
    try {
      const res = await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: this.opts.navTimeoutMs ?? 20_000 });
      await page.waitForTimeout(1500);
      const out: FetchOutput = { status: res?.status() ?? 0, body: await page.content(), finalUrl: page.url(), session: useSession };
      this.served++;
      return out;
    } finally {
      await page.close().catch(() => undefined);
      // Ephemeral contexts are closed immediately (each is single-use); the persistent
      // session stays warm. Recycle the shared clean browser after N pages.
      if (!useSession) await ctx.close().catch(() => undefined);
      if (this.served >= (this.opts.recycleAfter ?? 200) && this.browser) {
        const b = this.browser as unknown as { close(): Promise<void> };
        this.browser = null;
        this.served = 0;
        await b.close().catch(() => undefined);
      }
    }
  }

  /** Drop the wedged context so the next fetch launches a fresh one. */
  private async resetBrowser(useSession: boolean): Promise<void> {
    if (useSession) {
      const s = this.session;
      this.session = null;
      await (s as unknown as { close?(): Promise<void> })?.close?.().catch(() => undefined);
    } else {
      const b = this.browser;
      this.browser = null;
      this.served = 0;
      await (b as unknown as { close?(): Promise<void> })?.close?.().catch(() => undefined);
    }
  }

  /** Remove only one site's relay-profile cookies; clean contexts and siblings stay intact. */
  async revokeDomain(domain: string): Promise<void> {
    const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ctx = await this.sessionCtx();
    await ctx.clearCookies({ domain: new RegExp(`(^|\\.)${escaped}$`, "i") });
  }

  async close(): Promise<void> {
    await this.session?.close().catch(() => undefined);
    await (this.browser as unknown as { close?(): Promise<void> })?.close?.().catch(() => undefined);
  }
}
