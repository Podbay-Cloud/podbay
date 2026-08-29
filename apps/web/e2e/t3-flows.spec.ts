import { test, expect } from "@playwright/test";
import { login, launchPod } from "./helpers";

/**
 * The T3-unattended + agent-control-wizard flows shipped 2026-08-24 (fix/t3-launch-single-login,
 * agent-control-wizards). These lean on the fake stack (no real creds): a NO-SESSION-named pod holds
 * in the "login" phase (deriveSetupStep), a normally-named fake pod reaches "ready" instantly via
 * PODBAY_FAKE_SESSION_URL. What's covered here:
 *   - onboarding guided-setup has an in-screen "← Pods" escape (was a dead-end takeover)
 *   - a T3 launch (?enableT3=1) SKIPS the subscription /login onboarding step — the one-login fix
 *   - the Enable-T3 confirm modal carries the owner-approved copy
 *   - the unified ProviderAuthWizard sign-in takeover has a "Back to <pod>" button and returns
 */
test.describe("T3 + agent-control-wizard flows", () => {
  test("onboarding 'Cancel setup' confirms, then deletes the pod + returns to Configure", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    await launchPod(page, "nextjs-starter", { name: "NO-SESSION cancel-setup" });

    // It sits in guided setup (no session → holds pre-ready).
    await expect(page.getByText(/Building your machine|Sign in to|Starting your agent/i).first()).toBeVisible({
      timeout: 30_000,
    });
    // The wizard-level cancel (the pod is a real machine, so "back to Configure" = delete + reconfigure)
    // is guarded by a confirm before the destructive delete.
    const cancel = page.getByTestId("onboarding-cancel");
    await expect(cancel).toBeVisible();
    await cancel.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Cancel setup?")).toBeVisible();
    await dialog.getByRole("button", { name: /^Cancel setup$/ }).click();
    // Deletes the pod and returns to the pods dashboard.
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
  });

  test("a T3 launch lands on the setup-token wizard (not /login) and SURVIVES A REFRESH", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    const slug = await launchPod(page, "nextjs-starter", { name: "NO-SESSION t3-launch" });

    // Baseline: the same NO-SESSION pod WITHOUT the T3 flow shows the subscription sign-in card.
    await expect(page.getByText(/Sign in to Claude/i)).toBeVisible({ timeout: 30_000 });

    // A T3 launch lands here: launch-configure redirects control=t3 → ?wiz=renew-then-t3 (the URL-backed
    // setup-token wizard — the single 1-year login), NOT the subscription /login. The onboarding
    // "Sign in to Claude" card is skipped; the wizard (with its "Back to <pod>" escape) takes over.
    await page.goto(`/dashboard/pods/${slug}?wiz=renew-then-t3`);
    await expect(page.getByText("Sign in to Claude")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Back to/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/1-year Claude token/i)).toBeVisible();

    // The real bug the owner hit: the wizard is URL-backed, so a full refresh RESUMES it instead of
    // falling back to "Sign in to Claude" (the effPhase skip keys on the durable ?wiz, not a transient flag).
    await page.reload();
    await expect(page.getByRole("button", { name: /Back to/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Sign in to Claude")).toHaveCount(0);
  });

  test("the Enable-T3 confirm modal shows the owner-approved copy", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    await launchPod(page, "nextjs-starter", { name: "t3-enable-copy" });

    // Ready cockpit → Control tab (default) → the T3 Code control row.
    const enable = page.getByRole("button", { name: /Enable T3 Code/i });
    await expect(enable).toBeVisible({ timeout: 30_000 });
    await enable.click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Switch this pod to T3 Code?")).toBeVisible();
    await expect(dialog.getByText("T3 Code will control all agents on this pod.")).toBeVisible();
    await expect(dialog.getByText("You will continue work only via T3 Code.")).toBeVisible();
    await expect(dialog.getByText("The current conversations do not transfer.")).toBeVisible();
    // The removed wording must not resurface.
    await expect(dialog.getByText(/Let T3 Code control this pod\?/)).toHaveCount(0);
  });

  test("the Claude sign-in wizard takeover has a 'Back to <pod>' button that returns to the cockpit", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    const slug = await launchPod(page, "nextjs-starter", { name: "wizard-back" });

    // Reach the ready cockpit first.
    await expect(page.getByRole("button", { name: /Enable T3 Code/i })).toBeVisible({ timeout: 30_000 });

    // The sign-in takeover is URL-backed (survives refresh) — drive it directly.
    await page.goto(`/dashboard/pods/${slug}?wiz=signin:claude-code`);
    const back = page.getByRole("button", { name: /Back to/i });
    await expect(back).toBeVisible({ timeout: 30_000 });
    await back.click();
    // Returns to the cockpit (the wiz param is cleared; the Control tab is back).
    await expect(page.getByRole("button", { name: /Enable T3 Code/i })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp(`/dashboard/pods/${slug}(?!.*wiz=)`));
  });
});
