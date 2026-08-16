import { test, expect } from "@playwright/test";
import { login, launchPod } from "./helpers";

/**
 * Edge states the happy-path specs never reach: ownership 404s, the pending gate's
 * actual content, and sign-out.
 *
 * NOT covered here (deferred, see docs/plans/e2e-coverage-plan.md area 6): the
 * launch-FAILED and env-gone error screens, and provisioning-disabled buttons. Driving a
 * pod into `status=error` hermetically means failing the provisioner and waiting out its
 * retry/backoff — slow and flaky — and provisioning-disabled needs the whole server
 * booted with it off. Both want a fixture, not a live drive.
 */
test.describe("ownership + gates", () => {
  test("a non-owner gets a 404 for the cockpit and the terminal", async ({ page, browser }) => {
    // Owner launches a pod in their own context.
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await login(ownerPage, "approved");
    const slug = await launchPod(ownerPage);
    await ownerCtx.close();

    // A different signed-in user (admin, who is NOT the owner) cannot open the
    // owner-scoped cockpit or terminal — both are owner-scoped and 404.
    await login(page, "admin");
    const cockpit = await page.goto(`/dashboard/pods/${slug}`);
    expect(cockpit?.status()).toBe(404);
    const term = await page.goto(`/pods/${slug}`);
    expect(term?.status()).toBe(404);
  });

  test("the pending gate explains the wait and offers sign-out", async ({ page }) => {
    await login(page, "pending");
    await page.goto("/pending");
    await expect(page.getByRole("heading", { name: /You.?re on the list/i })).toBeVisible();
    await expect(page.getByText(/invite-only alpha/i)).toBeVisible();
    await expect(page.getByText("pending@podbay.test")).toBeVisible();
    // The gate's own escape hatch.
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  test("sign out ends the session and re-gates the dashboard", async ({ page }) => {
    await login(page, "approved");
    await page.goto("/dashboard");
    await page.getByTestId("user-menu").click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();

    // Sign-out redirects to the landing page; the dashboard now gates to sign-in.
    await expect(page).toHaveURL(/\/$|\/signin/, { timeout: 15_000 });
    const gated = await page.goto("/dashboard");
    expect(gated?.url()).toMatch(/\/signin/);
  });
});
