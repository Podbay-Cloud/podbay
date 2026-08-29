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
  test("Codex pairing is explicit, Back survives reload, and confirmation returns with the device pill", async ({
    page,
  }) => {
    await login(page, "approved");
    const slug = await launchPod(page, "nextjs-starter");
    await page.goto(`/dashboard/pods/${slug}`);

    const tour = page.getByTestId("connect-walkthrough");
    if (await tour.isVisible()) await tour.getByRole("button", { name: /^skip$/i }).click();

    const enable = page.getByRole("button", { name: /enable codex/i });
    await expect(enable).toBeVisible({ timeout: 15_000 });
    await enable.click();
    await page.locator("[role=alertdialog]").getByRole("button", { name: /^add codex$/i }).click();

    // Codex becoming live must not replace the cockpit just because no device label is remembered.
    const pair = page.getByRole("button", { name: /^pair a device$/i });
    await expect(pair).toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/wiz=pair/);

    // Back is a real dismissal, including across reload.
    await pair.click();
    await expect(page).toHaveURL(/wiz=pair/);
    await page.getByRole("button", { name: new RegExp(`Back to`, "i") }).first().click();
    await expect(page).not.toHaveURL(/wiz=pair/);
    await page.reload();
    await expect(pair).toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/wiz=pair/);

    // first10 regression: the record succeeded but the full-page wrapper did not close/refetch.
    await pair.click();
    await page.getByRole("button", { name: /^desktop$/i }).click();
    await page.getByRole("button", { name: /generate pairing code/i }).click();
    await page.getByPlaceholder("My desktop").fill("Work Desktop");
    // The button renders a curly apostrophe (I&rsquo;ve, matching the panel's other copy), not
    // a straight one — match either so this doesn't depend on which glyph the CTA uses.
    await page.getByRole("button", { name: /I[’']ve paired this/i }).click();

    await expect(page).not.toHaveURL(/wiz=pair/);
    await expect(page.getByRole("tab", { name: /control/i })).toBeVisible();
    await expect(page.getByText("Work Desktop", { exact: true })).toBeVisible();
  });

  test("offers the missing agent, adds it, and then stops offering", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page, "nextjs-starter"); // declares [claude-code, codex]
    await page.goto(`/dashboard/pods/${slug}`);

    // The ghost card's control reads "Enable Codex…" (agent-cards.tsx's `Enable {label(id)}…`).
    // NB the DIALOG's confirm is a different, exact "Add Codex" — don't collapse the two.
    const add = page.getByRole("button", { name: /enable codex/i });
    await expect(add).toBeVisible({ timeout: 15_000 });
    await add.click();

    // The confirm names the shared-workspace consequence before anything happens.
    const dialog = page.locator("[role=alertdialog]");
    await expect(dialog).toContainText(/workspace/i);
    await dialog.getByRole("button", { name: /^add codex$/i }).click(); // dialog's confirm is exact

    // Once the pod runs both: the offer is gone and each agent has its own card.
    await expect(page.getByRole("button", { name: /enable codex/i })).toHaveCount(0, {
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

    const add = page.getByRole("button", { name: /enable codex/i });
    await expect(add).toBeVisible({ timeout: 15_000 });
    await add.click();
    await page.locator("[role=alertdialog]").getByRole("button", { name: /^add codex$/i }).click();
    await expect(page.getByRole("button", { name: /enable codex/i })).toHaveCount(0, {
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
