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

  test("wizard without an env redirects to the environments gallery", async ({ page }) => {
    await login(page, "approved");
    await page.goto("/dashboard/pods/new");
    await expect(page).toHaveURL(/\/dashboard\/environments/);
  });
});
