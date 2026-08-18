import { test, expect } from "@playwright/test";
import { login, launchPod, waitForPodReady } from "./helpers";

/**
 * Fleet-updates (Feature C): the per-pod "Auto-update" exclude toggle in pod Settings.
 *
 * Cloud-only (the fake e2e stack runs as the cloud edition). The bulk "update N idle pods" button
 * (Feature A) is NOT exercised here: it needs a real pin-vs-digest "behind" state that the fake
 * stack deliberately doesn't produce (see update.spec.ts) — its logic is unit-covered in
 * control-plane/test/fleet-update-idle.test.ts instead. This spec verifies C end-to-end: the toggle
 * renders, flips, and PERSISTS across a reload (a real DB write via setPodAutoUpdate).
 */
test.describe("pod Settings — Auto-update exclude", () => {
  test("toggles between Included and Excluded and persists", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    await waitForPodReady(page, slug);

    await page.goto(`/dashboard/pods/${slug}?tab=settings`);

    // Default: auto-update ON (the switch is checked), included in the bulk action.
    const toggle = page.getByRole("switch", { name: "Auto-update" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();
    await expect(page.getByText(/On — included in the .Update idle pods. bulk action/i)).toBeVisible();

    // Turn off → the switch + label flip (optimistic).
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByText(/Off — skipped by/i)).toBeVisible();

    // Let the setPodAutoUpdate server action commit before reloading (the flip above is
    // optimistic; reloading mid-write would race the DB persist).
    await page.waitForLoadState("networkidle");

    // Durable: a reload still shows OFF (persisted to the pod row, not just local state).
    await page.reload();
    await expect(page.getByRole("switch", { name: "Auto-update" })).not.toBeChecked();
    await expect(page.getByText(/Off — skipped by/i)).toBeVisible();

    // And back ON.
    await page.getByRole("switch", { name: "Auto-update" }).click();
    await expect(page.getByText(/On — included in the .Update idle pods. bulk action/i)).toBeVisible();
  });
});
