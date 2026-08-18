import { test, expect } from "@playwright/test";
import { login, launchPod, waitForPodReady } from "./helpers";

/**
 * Live config-refresh (docs/plans/live-config-refresh.md), Feature: the pod Settings "Sync config"
 * button. This exercises the software orchestration end-to-end against the fake stack — the button
 * → server action → control-plane `refreshPodConfig` → `provider.refreshConfig` (FakeProvider records
 * it and returns refreshed:true) → success feedback. The actual IN-POD re-apply (init.sh refresh
 * blocks, no agent restart) is verified separately on a real pod; the fake provider has no init.sh.
 */
test.describe("pod Settings — Sync config (live refresh)", () => {
  test("Sync now delivers the config and reports success without a restart", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    await waitForPodReady(page, slug);

    await page.goto(`/dashboard/pods/${slug}?tab=settings`);

    const btn = page.getByRole("button", { name: /^Sync now$/ });
    await expect(btn).toBeVisible();
    await expect(page.getByText(/Pull the latest rules, skills & settings/i)).toBeVisible();

    await btn.click();

    // FakeProvider.refreshConfig returns refreshed:true → the success copy renders.
    await expect(page.getByText(/Synced — live changes apply now/i)).toBeVisible();
  });
});
