import type { Page } from "@playwright/test";
import { USERS, DB } from "./users";

type UserKey = keyof typeof USERS;

/**
 * The connect walkthrough is now a PER-USER, once-ever thing (not per-pod). Tests share a
 * fixed "approved" user, so once ANY test has let the tour auto-mark itself seen, later
 * tests that need it to appear would find it already dismissed. Clear the flag directly in
 * the test DB to isolate a test that depends on the tour showing.
 */
export async function resetWalkthroughSeen(email: string): Promise<void> {
  const { Client } = await import("pg");
  const c = new Client({ connectionString: DB.url });
  await c.connect();
  try {
    await c.query(`UPDATE "user" SET walkthrough_seen_at = NULL WHERE email = $1`, [email]);
  } finally {
    await c.end();
  }
}

/**
 * Pre-record a cookie-consent choice so the banner never renders.
 *
 * It is a fixed, full-width bar pinned to the BOTTOM at z-50, so it genuinely intercepts
 * pointer events for anything beneath it — Playwright named it as the blocker on four
 * cockpit tests ("subtree intercepts pointer events"), which then failed as 90s click
 * timeouts pointing at innocent buttons. Every signed-in spec should run as a returning
 * visitor who has already chosen, which is exactly what this cookie represents.
 *
 * NOTE: nothing currently e2e-tests the banner itself, so this hides no coverage — but that
 * gap is real and worth its own spec (recorded in 0audit).
 */
export async function acceptCookies(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: "pb-cookie-consent", value: "granted", url: "http://localhost:3111" },
  ]);
}

/**
 * Sign a test user in via the real email+password API (test-login mode). Uses
 * the page's request context so the session cookie lands in the browser. Signs
 * up on first use, signs in if the account already exists.
 */
export async function login(page: Page, key: UserKey): Promise<void> {
  const u = USERS[key];
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: { email: u.email, password: u.password, name: u.name },
    failOnStatusCode: false,
  });
  if (!signup.ok()) {
    const signin = await page.request.post("/api/auth/sign-in/email", {
      data: { email: u.email, password: u.password },
      failOnStatusCode: false,
    });
    if (!signin.ok()) {
      throw new Error(`test login failed for ${key}: ${signin.status()} ${await signin.text()}`);
    }
  }
  // AFTER the auth calls, never before: seeding a cookie first makes these requests
  // "credentialed", which trips better-auth's CSRF origin check — and `page.request` sends no
  // Origin header until the page has navigated. Setting it first turned 4 failures into 69,
  // all of them `403 MISSING_OR_NULL_ORIGIN`.
  await acceptCookies(page);
}

/**
 * Launch a pod through the wizard page (fake provider) and return its slug.
 * "Launch" on a tile links to /dashboard/pods/new?env=…; the wizard's "Launch
 * pod" creates it and then renders a /pods/<slug> web-terminal link.
 */
export async function launchPod(
  page: import("@playwright/test").Page,
  env = "nextjs-starter",
  opts: { name?: string; agent?: string } = {},
): Promise<string> {
  const podName = opts.name ?? "e2e-pod";
  // Launch a NAMED environment. This used to click the first "Launch" link in the
  // catalog, which silently became `byo-project` once that env existed — and a BYO
  // env REQUIRES a repository, so "Create pod" stays disabled and every test that
  // launched a pod timed out. Nobody saw it because the suite couldn't run without
  // Docker (fixed 2026-07-29); a helper that depends on catalog ORDER is fragile by
  // construction, so it now asks for what it wants.
  await page.goto(`/dashboard/pods/new?env=${env}`);
  // Walk the launch wizard (Basics → [GitHub] → [Settings] → Review): on each step
  // fill any secret fields (so a required one doesn't keep the step gated), then
  // advance — clicking "Create pod" as soon as the Review step offers it. Non-BYO
  // envs only, so there's no GitHub repo gate to satisfy here.
  for (let guard = 0; guard < 6; guard++) {
    // Basics requires a name before Next enables — fill it when the field is present.
    const nameInput = page.locator("#pod-name");
    if ((await nameInput.count()) > 0 && !(await nameInput.inputValue())) {
      await nameInput.fill(podName);
    }
    const secretInputs = page.locator('input[type="password"]');
    for (let i = 0; i < (await secretInputs.count()); i++) {
      await secretInputs.nth(i).fill("e2e-placeholder");
    }
    // Pick a non-default primary agent when asked (the agent step is a radio-group; the
    // default is the env's first agent). Selecting it makes it the pod's sole/primary agent.
    if (opts.agent) {
      const radio = page.getByRole("radio", { name: new RegExp(opts.agent, "i") });
      if ((await radio.count()) > 0 && (await radio.getAttribute("aria-checked")) !== "true") {
        await radio.click();
      }
    }
    const create = page.getByRole("button", { name: /^create pod$/i });
    if ((await create.count()) > 0) {
      await create.click();
      break;
    }
    await page.getByRole("button", { name: /^next$/i }).click();
  }
  // Once the pod exists we navigate to its durable setup page — the slug is in
  // the URL, so state survives refresh/close/reopen. Wait for a REAL slug (not
  // the /new configure route it starts on).
  await page.waitForURL(
    (u) => /^\/dashboard\/pods\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith("/new"),
    // The first pod-creating test in a run boots a cold in-process agent/gateway stack
    // and compiles the cockpit route — slow on a constrained pod. Generous budget.
    { timeout: 60_000 },
  );
  const slug = new URL(page.url()).pathname.split("/").pop();
  if (!slug) throw new Error(`no pod slug in setup URL: ${page.url()}`);
  return slug;
}

/**
 * Wait until a freshly-launched pod is actually READY (the cockpit tab strip has
 * rendered). `launchPod` returns as soon as the cockpit URL commits, which can be while
 * the pod is still provisioning — before the fake provider has persisted its record —
 * so any follow-up that hits the provider (clone, admin action) can race "pod not found".
 * Call this first when the next step talks to the provider.
 */
export async function waitForPodReady(page: Page, slug: string): Promise<void> {
  await page.goto(`/dashboard/pods/${slug}?tab=settings`);
  await page
    .getByRole("tab", { name: /settings/i })
    .waitFor({ state: "visible", timeout: 60_000 });
}

/**
 * Make ONE pod report problems, without touching any other pod in the run.
 *
 * e2e runs specs in parallel against a single server, so anything process-wide
 * (an env var, a provider field) would leak across specs. The fake provider reads
 * per-pod health from a sidecar of its shared state file; this writes that file.
 * Pass `null` to make the pod healthy again.
 */
export async function scriptPodHealth(
  slug: string,
  health: {
    issues?: { id: string; severity: string; title: string; detail: string; fixable: boolean; agent?: string }[];
    doctor?: {
      checked: number;
      issues: { id: string; severity: string; title: string; detail: string; fixed: boolean; invasive?: boolean }[];
    };
  } | null,
): Promise<void> {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const path = await import("node:path");
  const state = JSON.parse(
    readFileSync(path.join(process.cwd(), ".e2e-state.json"), "utf8"),
  ) as { fakeStateFile?: string };
  if (!state.fakeStateFile) throw new Error("e2e state has no fakeStateFile — is global-setup current?");
  const file = `${state.fakeStateFile}.health.json`;
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    /* first writer */
  }
  if (health === null) delete all[slug];
  else all[slug] = health;
  writeFileSync(file, JSON.stringify(all));
}

/**
 * Script a pod's fake GitHub-connection + workspace-emptiness (same sidecar as
 * {@link scriptPodHealth}, merged so both can be set). The real device flow can't run
 * headless, so this is how e2e reaches the "connected → choose repo → clone" step —
 * and, with `workEmpty: false`, the confirmed overwrite path.
 */
export async function scriptPodGithub(
  slug: string,
  patch: { gh?: boolean; workEmpty?: boolean },
): Promise<void> {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const path = await import("node:path");
  const state = JSON.parse(
    readFileSync(path.join(process.cwd(), ".e2e-state.json"), "utf8"),
  ) as { fakeStateFile?: string };
  if (!state.fakeStateFile) throw new Error("e2e state has no fakeStateFile — is global-setup current?");
  const file = `${state.fakeStateFile}.health.json`;
  let all: Record<string, Record<string, unknown>> = {};
  try {
    all = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, unknown>>;
  } catch {
    /* first writer */
  }
  all[slug] = { ...(all[slug] ?? {}), ...patch };
  writeFileSync(file, JSON.stringify(all));
}

/**
 * Script the secrets an agent has "asked for" from inside a pod (same per-pod sidecar),
 * so the cockpit's agent-request callout can be exercised without a real running agent.
 */
export async function scriptPodSecretRequests(
  slug: string,
  requests: { key: string; description: string; at: string }[],
): Promise<void> {
  await scriptPodGithub(slug, { secretRequests: requests } as never);
}
