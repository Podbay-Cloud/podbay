import { test, expect } from "@playwright/test";
import { login, launchPod } from "./helpers";

/**
 * Multi-agent slice 3: a pod launched from an env that declares BOTH CLIs can
 * gain the second one from the cockpit, without touching the first agent's
 * session. The affordance must not appear when there is nothing to add.
 *
 * Uses the shared `launchPod` (walks the wizard, fills the name/secrets) — the old inline
 * helper clicked "Create pod" on step 1 and never got past Basics on a multi-step wizard.
 */
test.describe("adding a second agent from the cockpit", () => {
  test("offers the missing agent, adds it, and then stops offering", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page, "nextjs-starter"); // declares [claude-code, codex]
    await page.goto(`/dashboard/pods/${slug}`);

    // The ghost card's control reads "+ Add Codex" — match loosely on purpose so a
    // cosmetic label tweak doesn't fail a behavioural test.
    const add = page.getByRole("button", { name: /add codex/i });
    await expect(add).toBeVisible({ timeout: 15_000 });
    await add.click();

    // The confirm names the shared-workspace consequence before anything happens.
    const dialog = page.locator("[role=alertdialog]");
    await expect(dialog).toContainText(/workspace/i);
    await dialog.getByRole("button", { name: /^add codex$/i }).click(); // dialog's confirm is exact

    // Once the pod runs both: the offer is gone and each agent has its own card.
    await expect(page.getByRole("button", { name: /add codex/i })).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.getByText("Claude", { exact: true })).toBeVisible();
    await expect(page.getByText("Codex", { exact: true })).toBeVisible();
  });

  test("two agents on a phone: no sideways scroll, both cards readable", async ({ page }) => {
    // dual-agent-pods 3.6. A second agent doubles the ready state's height, and the
    // agent cards carry long status lines — the risk is a cockpit that scrolls
    // sideways or truncates a card's meaning on a 390px screen.
    await page.setViewportSize({ width: 390, height: 780 });
    await login(page, "approved");
    const slug = await launchPod(page, "nextjs-starter");
    await page.goto(`/dashboard/pods/${slug}`);

    const add = page.getByRole("button", { name: /add codex/i });
    await expect(add).toBeVisible({ timeout: 15_000 });
    await add.click();
    await page.locator("[role=alertdialog]").getByRole("button", { name: /^add codex$/i }).click();
    await expect(page.getByRole("button", { name: /add codex/i })).toHaveCount(0, {
      timeout: 20_000,
    });

    // Both agents present…
    await expect(page.getByText("Claude", { exact: true })).toBeVisible();
    await expect(page.getByText("Codex", { exact: true })).toBeVisible();
    // …and the page does not scroll sideways, which is what makes a phone cockpit
    // feel broken.
    const overflow = await page.evaluate(() => {
      const m = document.querySelector("main");
      return m ? m.scrollWidth > m.clientWidth : false;
    });
    expect(overflow, "cockpit scrolls horizontally at 390px").toBe(false);
  });
});
