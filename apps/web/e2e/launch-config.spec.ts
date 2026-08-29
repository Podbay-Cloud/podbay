import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("launch wizard", () => {
  test("steps through Basics → Settings → Review, gating each step, then launches", async ({
    page,
  }) => {
    // Walking the wizard + creating a pod (real in-process pod-agent/gateway stack)
    // compiles several routes in dev mode and boots an agent — slow on a constrained
    // pod. Give it generous room beyond the 30s default.
    test.setTimeout(180_000);
    await login(page, "approved");

    // doc-qa: non-BYO, single-agent, one required secret (ANTHROPIC_API_KEY) → the
    // wizard is Basics → Settings → Review (no GitHub step, no agent choice).
    await page.goto("/dashboard/pods/new?env=doc-qa");
    await expect(page.getByRole("heading", { name: /new pod — ask your docs/i })).toBeVisible();

    // Step 1 — Basics. Name lives here; there's no "Create pod" yet, only "Next".
    await expect(page.getByText(/step 1 of 3 — basics/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^create pod$/i })).toHaveCount(0);
    await page.getByLabel("Name").fill("e2e Chef");
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 2 — Settings. The required secret gates "Next" until it's filled.
    await expect(page.getByText(/step 2 of 3 — settings/i)).toBeVisible();
    const next = page.getByRole("button", { name: /^next$/i });
    await expect(next).toBeDisabled();
    await page.locator('input[type="password"]').first().fill("sk-e2e-placeholder");
    await expect(next).toBeEnabled();
    await next.click();

    // Step 3 — Review. Now "Create pod" appears and is enabled.
    await expect(page.getByText(/step 3 of 3 — review/i)).toBeVisible();
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
    await expect(page.getByText(/step 2 of 3 — settings/i)).toBeVisible();
    await page.locator('input[type="password"]').first().fill("sk-e2e-placeholder");

    // Reload mid-wizard: same step, and the required secret is still filled (so Next
    // stays enabled). Going Back shows the name typed on Basics survived too.
    await page.reload();
    await expect(page.getByText(/step 2 of 3 — settings/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^next$/i })).toBeEnabled();
    await page.getByRole("button", { name: /^back$/i }).click();
    await expect(page.getByLabel("Name")).toHaveValue("e2e Chef");
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
    await expect(page.getByText(/step 1 of 3 — basics/i)).toBeVisible();
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
    await expect(page.getByText(/step 2 of 3 — settings/i)).toBeVisible();

    // The new step starts at its beginning, not wherever the previous one was scrolled to.
    await expect.poll(offset).toBe(0);
    await expect(page.getByText(/step 2 of 3 — settings/i)).toBeInViewport();
  });

  test("wizard without an env redirects to the environments gallery", async ({ page }) => {
    await login(page, "approved");
    await page.goto("/dashboard/pods/new");
    await expect(page).toHaveURL(/\/dashboard\/environments/);
  });
});
