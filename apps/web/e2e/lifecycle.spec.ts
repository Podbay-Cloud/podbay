import { test, expect } from "@playwright/test";
import { login, launchPod } from "./helpers";

test.describe("pod launch + lifecycle", () => {
  test("launch routes to a pod that appears on the dashboard", async ({ page }) => {
    await login(page, "approved");
    await launchPod(page);
    await page.goto("/dashboard");
    // The card shows the pod's NAME (launchPod names it "e2e-pod"), not the raw slug.
    await expect(page.locator('[data-testid=pod-card]').filter({ hasText: "e2e-pod" }).first()).toBeVisible();
  });

  test("sleep then wake from the cockpit (via the confirm dialog)", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    // Suspend lives on the SETTINGS tab (pod-cockpit.tsx renders it in
    // `TabsContent value="settings"`), but the cockpit's default tab is Control — so landing on
    // the bare pod URL and reaching for Suspend waited 90s for a button that was never on screen.
    // Deep-link straight to the tab that owns the control (the cockpit reads `?tab=`), rather than
    // clicking through, so the test fails on the ACTION if it breaks, not on navigation.
    await page.goto(`/dashboard/pods/${slug}?tab=settings`);

    // The verb is "Suspend"/"Resume" — the product renamed it from sleep/wake and
    // this spec kept clicking the old label (the suite was unrunnable, so nothing
    // caught it). Match both so a future rename fails LOUDLY on one assertion
    // rather than on every click.
    await page.getByRole("button", { name: /^(suspend|sleep now)$/i }).first().click();
    await page
      .locator("[role=alertdialog]")
      .getByRole("button", { name: /^(suspend|sleep now)$/i })
      .click();
    // A suspended pod TAKES OVER the cockpit (pod-suspended.tsx) — the tabbed UI and its
    // status badge are replaced entirely, so `[data-testid=pod-status]` does not merely
    // change, it stops existing. Asserting on it could never pass: the old badge read
    // "Running" until the takeover mounted, then vanished. Assert the takeover itself.
    // Generous budget because service.sleep() first gives the agent a chance to write a
    // handoff note (best-effort, time-boxed at HANDOFF_TIMEOUT_MS = 60s).
    const resume = page.getByRole("button", { name: /^resume pod/i });
    await expect(resume).toBeVisible({ timeout: 75_000 });
    await expect(page.getByText(/hidden while suspended/i)).toBeVisible();

    await resume.click();
    // Resume is confirm-gated too ("Resume <pod>? It starts using compute again and counts toward
    // your slots"), same as Suspend. The spec answered the SUSPEND dialog but not this one, so it
    // sat waiting for a status badge that could not appear while the dialog held the screen — more
    // drift from the period when the suite was unrunnable.
    await page
      .locator("[role=alertdialog]")
      .getByRole("button", { name: /^resume$/i })
      .click();
    // What "resumed" actually looks like: the suspended takeover is gone and the card is no longer
    // reporting Suspended. Do NOT assert a specific word — `data-testid=pod-status` is carried by
    // TWO different chips by design (ui-patterns.md "Chips / pills"): the flat lifecycle StatusBadge
    // (Running/Suspended) and the bordered agent-ACTIVITY pill (Working/Idle/Waiting for you/Needs
    // you), whichever is currently truthful. Once the pod is back and live signals arrive, activity
    // wins — so a /running|waking|resuming/ match raced the signal and failed on the perfectly
    // correct "Waiting for you".
    await expect(page.getByRole("button", { name: /^resume pod/i })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.locator("[data-testid=pod-status]")).not.toContainText(/suspended/i, {
      timeout: 15_000,
    });
  });

  test("delete from the cockpit returns to the dashboard and the card is gone", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    await page.goto(`/dashboard/pods/${slug}`);

    await page.getByRole("tab", { name: /admin/i }).click(); // Terminal + Delete live here now
    await page.getByRole("button", { name: /^delete$/i }).click();
    // Wait for the AlertDialog to finish animating in before clicking its confirm — the
    // flaky failure was "element visible, enabled, but not stable", i.e. the button was
    // moving under the click. Asserting the dialog first lets it settle.
    const dialog = page.locator("[role=alertdialog]");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^delete pod$/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
    await expect(page.locator('[data-testid=pod-card]', { hasText: slug })).toHaveCount(0);
  });

  test("a resize announces itself: one state, progress, and read-only settings", async ({ page }) => {
    // Reported live: "during resize it didn't change running state to resizing,
    // didn't show progress under the button like update, and the whole cockpit
    // should be read-only." A silent multi-minute restart reads as a hung page.
    await login(page, "approved");
    const slug = await launchPod(page);
    await page.goto(`/dashboard/pods/${slug}?tab=settings`);

    const change = page.getByRole("button", { name: "Change" });
    await expect(change).toBeVisible({ timeout: 20_000 });
    await change.click();
    // Pick a different tier than the launch default, or the action is a no-op.
    // Pick a tier other than the launch default, then confirm.
    await page.getByRole("button", { name: /Large/ }).first().click();
    await page.getByRole("button", { name: /^Resize to/ }).click();

    // The pod must report ONE state, and it must be the right verb.
    await expect(page.getByText(/Resizing/).first()).toBeVisible({ timeout: 30_000 });
    // …it must say why the settings stopped responding…
    // A resize now takes over the WHOLE cockpit (pod-updating.tsx) instead of disabling
    // controls inside the tabs, so the old settings-tab line ("settings are read-only until it
    // finishes") no longer renders during one. Assert the promise the dedicated state actually
    // makes — that nothing is lost — which is the reassurance this test exists to protect.
    // The standalone "Nothing is lost." block was removed as redundant (2026-08-29): the intro
    // line already carries that promise, so assert IT rather than dropping the guarantee.
    await expect(page.getByText(/Your workspace stays exactly as it is/i)).toBeVisible();
    await expect(page.getByText(/comes back automatically/i)).toBeVisible();
    // The settings CONTROLS must be unreachable while it runs. They used to be disabled
    // in place; the takeover removes them outright, which is strictly stronger — so assert
    // they are gone rather than that a button which no longer exists is disabled.
    await expect(page.getByRole("button", { name: "Change" })).toHaveCount(0);
    // Progress the owner can read: the real backend stage plus a ticking elapsed clock.
    // ("stopping · 3s" was the old in-tab row's format; the takeover renders the stage as a
    // label and the elapsed time as mm:ss.)
    await expect(page.getByText(/Stopping the pod/i)).toBeVisible();
    await expect(page.getByText(/^\d+:\d{2}$/)).toBeVisible();
  });
});