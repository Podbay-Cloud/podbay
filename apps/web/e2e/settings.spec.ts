import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * Settings → the RelayConnectCard, the owner's own place to bring a relay up. Only the
 * cockpit's ⓘ explainer was tested before; this covers the actual command-minting flow.
 */
test.describe("settings — relay connect", () => {
  test("mint a pairing command, see it with a countdown, and regenerate", async ({ page, context }) => {
    // Copy uses navigator.clipboard; grant it so the copy button doesn't error.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    await login(page, "approved");
    await page.goto("/dashboard/settings");

    await expect(page.getByText(/Relay — fetch from your own machine/i)).toBeVisible();
    // No relay running for a fresh owner.
    await expect(page.getByText("Not connected")).toBeVisible();

    // Generate the one-line command the owner runs on their own machine.
    await page.getByRole("button", { name: /^Generate command$/i }).click();
    const code = page.locator("code", { hasText: /npx @podbay\/relay@latest start/i });
    await expect(code).toBeVisible({ timeout: 15_000 });
    await expect(code).toContainText("--code");
    // The card states the single-use code's countdown.
    await expect(page.getByText(/expires in about/i)).toBeVisible();

    // The copy control is present (clipboard result varies headless — don't assert the toast).
    await expect(page.getByRole("button").filter({ has: page.locator("svg") }).first()).toBeVisible();

    // Regenerate mints a fresh command (the code is single-use).
    const first = (await code.textContent()) ?? "";
    await page.getByRole("button", { name: /Generate a new one/i }).click();
    await expect(async () => {
      const next =
        (await page.locator("code", { hasText: /@podbay\/relay@latest start/i }).textContent()) ?? "";
      expect(next).toMatch(/--code/);
      expect(next).not.toEqual(first);
    }).toPass({ timeout: 15_000 });
  });
});
