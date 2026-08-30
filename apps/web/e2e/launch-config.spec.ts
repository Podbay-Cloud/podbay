import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";
import { USERS } from "./users";

async function seedGithubConnection(email: string): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { Client } = await import("pg");
  const { encryptSecret } = await import("@podbay/shared/crypto");
  const state = JSON.parse(
    readFileSync(path.join(process.cwd(), ".e2e-state.json"), "utf8"),
  ) as { dbUrl?: string };
  if (!state.dbUrl) throw new Error("e2e state has no dbUrl — is global-setup current?");

  const client = new Client({ connectionString: state.dbUrl });
  await client.connect();
  try {
    const user = await client.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email]);
    if (!user.rows[0]) throw new Error(`no e2e user for ${email}`);
    await client.query(
      `INSERT INTO github_connections (user_id, token_enc, login, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
       SET token_enc = EXCLUDED.token_enc, login = EXCLUDED.login, expires_at = EXCLUDED.expires_at`,
      [
        user.rows[0].id,
        encryptSecret("e2e-github-token", Buffer.alloc(32)),
        "octocat",
        new Date(Date.now() + 60 * 60 * 1000),
      ],
    );
  } finally {
    await client.end();
  }
}

async function expectStep(page: Page, label: string, current: number, total: number): Promise<void> {
  const main = page.getByRole("main");
  // The step LABEL can appear twice (e.g. "Agents" is both the header and the agents-picker label);
  // the header is first in the DOM. The "N / M" counter is the unique per-step signal.
  await expect(main.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(main.getByText(`${current} / ${total}`, { exact: true })).toBeVisible();
}

test.describe("launch wizard", () => {
  test("steps through Basics → Agents → Secrets → Review, gating each step, then launches", async ({
    page,
  }) => {
    // Walking the wizard + creating a pod (real in-process pod-agent/gateway stack)
    // compiles several routes in dev mode and boots an agent — slow on a constrained
    // pod. Give it generous room beyond the 30s default.
    test.setTimeout(180_000);
    await login(page, "approved");

    // doc-qa: non-BYO, one required secret (ANTHROPIC_API_KEY) → Basics → Agents → Secrets →
    // Review (no GitHub step). Agents and secrets are separate steps.
    await page.goto("/dashboard/pods/new?env=doc-qa");
    await expect(page.getByRole("heading", { name: /new pod — ask your docs/i })).toBeVisible();

    // Step 1 — Basics. Name lives here; there's no "Create pod" yet, only "Next".
    await expectStep(page, "Basics", 1, 4);
    await expect(page.getByRole("button", { name: /^create pod$/i })).toHaveCount(0);
    await page.getByLabel("Name").fill("e2e Chef");
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 2 — Agents. No gate (an agent is always selected); just advance.
    await expectStep(page, "Agents", 2, 4);
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 3 — Secrets. The required secret gates "Next" until it's filled.
    await expectStep(page, "Secrets", 3, 4);
    const next = page.getByRole("button", { name: /^next$/i });
    await expect(next).toBeDisabled();
    await page.locator('input[type="password"]').first().fill("sk-e2e-placeholder");
    await expect(next).toBeEnabled();
    await next.click();

    // Step 4 — Review. Now "Create pod" appears and is enabled.
    await expectStep(page, "Review", 4, 4);
    const launch = page.getByRole("button", { name: /^create pod$/i });
    await expect(launch).toBeEnabled();
    await launch.click();

    // Once the pod exists we land on its durable setup page (slug in the URL).
    await page.waitForURL(
      (u) => /^\/dashboard\/pods\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith("/new"),
      { timeout: 120_000 },
    );
    await expect(page.locator("[data-testid=cockpit-name]")).toBeVisible();

    // The launched pod carries the name we set (shown on the dashboard cards).
    await page.goto("/dashboard");
    await expect(page.getByText("e2e Chef")).toBeVisible({ timeout: 15_000 });
  });

  test("the wizard survives a reload — step and fields restore", async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, "approved");

    await page.goto("/dashboard/pods/new?env=doc-qa");
    await page.getByLabel("Name").fill("e2e Chef");
    await page.getByRole("button", { name: /^next$/i }).click();
    await expectStep(page, "Agents", 2, 4);
    await page.getByRole("button", { name: /^next$/i }).click();
    await expectStep(page, "Secrets", 3, 4);
    await page.locator('input[type="password"]').first().fill("sk-e2e-placeholder");

    // Reload mid-wizard: same step, and the required secret is still filled (so Next
    // stays enabled). Going Back to Basics shows the name typed there survived too.
    await page.reload();
    await expectStep(page, "Secrets", 3, 4);
    await expect(page.getByRole("button", { name: /^next$/i })).toBeEnabled();
    await page.getByRole("button", { name: /^back$/i }).click(); // → Agents
    await page.getByRole("button", { name: /^back$/i }).click(); // → Basics
    await expect(page.getByLabel("Name")).toHaveValue("e2e Chef");
  });

  test("the connected repository step stays compact on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, "approved");
    await seedGithubConnection(USERS.approved.email);

    await page.goto("/dashboard/pods/new?env=byo-project");
    await page.getByLabel("Name").fill("e2e BYO");
    await page.getByRole("button", { name: /^next$/i }).click();

    await expectStep(page, "GitHub", 2, 4);
    // Exactly one Repository label (the field renders its own; launch-configure no longer duplicates
    // it). The visible text is "Repository *" with an sr-only " required", so target it by id.
    const repoLabel = page.locator("#github-repository-label");
    await expect(repoLabel).toHaveCount(1);
    await expect(repoLabel).toContainText("Repository");
    await expect(page.getByLabel("GitHub connected as @octocat")).toBeVisible();
    const next = page.getByRole("button", { name: /^next$/i });
    await expect(next).toBeDisabled();
    const picker = page.getByRole("button", { name: /Repository required/i });
    await expect(picker).toHaveAccessibleDescription("Choose a repository…");
    await picker.click();
    await page.getByRole("option", { name: "octocat/hello-world" }).click();
    await expect(picker).toHaveAccessibleDescription("octocat/hello-world");
    await expect(next).toBeEnabled();
    await expect(page.getByText("Your repository", { exact: false })).toHaveCount(0);
    await expect(page.getByText("The repo to work on", { exact: false })).toHaveCount(0);

    const card = await page.locator('[data-slot="card"]').boundingBox();
    expect(card, "repository card should render").not.toBeNull();
    expect(card!.height, "repository card should stay compact").toBeLessThan(240);
    await expect(page.getByRole("button", { name: /^back$/i })).toBeInViewport();
    await expect(next).toBeInViewport();
    if (process.env.VISUAL_OUT) {
      await page.screenshot({ path: `${process.env.VISUAL_OUT}/byo-repository-mobile.png`, fullPage: true });
    }
  });

  // Owner report, 2026-08-27: on mobile, advancing a wizard (or pressing Update) left the page at
  // its OLD scroll offset, so the next step opened already scrolled past its heading. The Next
  // button sits at the bottom of the step, which is exactly where a phone user is when they tap it.
  test("advancing a step scrolls back to the top (mobile)", async ({ page }) => {
    test.setTimeout(120_000);
    // Deliberately short, so the step's content is guaranteed taller than the viewport and the
    // page genuinely scrolls — the precondition the bug needs.
    await page.setViewportSize({ width: 390, height: 620 });
    await login(page, "approved");

    await page.goto("/dashboard/pods/new?env=doc-qa");
    await expectStep(page, "Basics", 1, 4);
    await page.getByLabel("Name").fill("e2e Scroll");

    // The dashboard shell scrolls its <main> (dashboard-shell.tsx: `overflow-y-auto`), NOT the
    // window — window.scrollY is always 0 inside the shell, which is precisely why the original
    // window.scrollTo fix was a silent no-op. Assert against the real scroller.
    const offset = () => page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0);

    // Put the view where a phone user is when they reach Next: at the bottom.
    await page.evaluate(() => {
      const m = document.querySelector("main");
      if (m) m.scrollTop = m.scrollHeight;
    });
    expect(await offset(), "step 1 must be scrollable for this test to mean anything").toBeGreaterThan(0);

    await page.getByRole("button", { name: /^next$/i }).click();
    await expectStep(page, "Agents", 2, 4);

    // The new step starts at its beginning, not wherever the previous one was scrolled to.
    await expect.poll(offset).toBe(0);
    await expect(page.getByRole("main").getByText("Agents", { exact: true }).first()).toBeInViewport();
  });

  test("wizard without an env redirects to the environments gallery", async ({ page }) => {
    await login(page, "approved");
    await page.goto("/dashboard/pods/new");
    await expect(page).toHaveURL(/\/dashboard\/environments/);
  });
});
