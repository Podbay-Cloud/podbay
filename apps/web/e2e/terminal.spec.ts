import { test, expect } from "@playwright/test";
import { login, launchPod } from "./helpers";

test.describe("live terminal", () => {
  test("connects and echoes a typed command through the real gateway + pod-agent", async ({
    page,
  }) => {
    await login(page, "approved");
    const slug = await launchPod(page);

    await page.goto(`/pods/${slug}`);
    // Terminal reaches connected (top-bar state pill).
    await expect(page.locator(".term-state-connected")).toBeVisible({ timeout: 30_000 });

    // Type a unique command; the real shell in the pod-agent echoes it back.
    const marker = `PODBAY_E2E_${Date.now()}`;
    await page.locator(".term").click();
    await page.keyboard.type(`echo ${marker}`);
    await page.keyboard.press("Enter");

    // xterm renders output into .xterm-rows — the marker appears twice (the
    // typed line + the echo); assert it's there at all.
    await expect(page.locator(".xterm-rows")).toContainText(marker, { timeout: 15_000 });
  });

  // NOTE: the tmux window strip + its "New window (+)" only appear once a pod already has
  // >1 window, which a single-agent fake pod never reaches — so bootstrapping a second
  // window from the UI isn't testable hermetically. Left uncovered on purpose (a
  // multi-agent pod, whose agents each get a window, would be the way in).
});

/**
 * The key bar (and its Paste fallback) exists only for TOUCH keyboards — CSS hides it
 * where a real keyboard + hover pointer exist. So it's exercised in a mobile context.
 */
test.describe("terminal on touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });

  test("the paste fallback opens a textarea to insert into the PTY", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    await page.goto(`/pods/${slug}`);
    await expect(page.locator(".term-state-connected")).toBeVisible({ timeout: 30_000 });

    // Clipboard writes to a terminal aren't a trusted gesture, so Paste opens an
    // OS-pasteable textarea instead.
    await expect(page.getByRole("button", { name: /^Paste$/ })).toBeVisible();
    await page.getByRole("button", { name: /^Paste$/ }).click();
    const dialog = page.getByRole("dialog", { name: /Paste into terminal/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox").fill("ls -la");
    await page.getByRole("button", { name: /Insert/i }).click();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("suspended pod terminal", () => {
  test("a suspended pod shows a Resume prompt instead of connecting", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, "approved");
    const slug = await launchPod(page);

    // Suspend from the cockpit (dismiss the once-per-pod walkthrough first).
    await page.goto(`/dashboard/pods/${slug}?tab=settings`);
    // One click now: the tour has a Skip on every step but the last, so stepping through
    // it with Next was only ever a workaround for not having one.
    const tour = page.getByTestId("connect-walkthrough");
    if (await tour.isVisible({ timeout: 8000 }).catch(() => false)) {
      await tour.getByRole("button", { name: /^(skip|done)$/i }).first().click().catch(() => undefined);
      await tour.waitFor({ state: "hidden" }).catch(() => undefined);
    }
    await page.getByRole("button", { name: /^Suspend$/ }).click();
    await page.locator("[role=alertdialog]").getByRole("button", { name: /^Suspend$/ }).click();
    // A suspended pod replaces the cockpit with pod-suspended.tsx, whose control is
    // "Resume pod …" — /^Resume$/ matched the old in-tab button that no longer exists. The
    // budget covers service.sleep()'s best-effort handoff wait (up to 60s).
    await expect(page.getByRole("button", { name: /^resume pod/i })).toBeVisible({ timeout: 75_000 });

    // Opening the terminal now shows the Resume prompt, NOT a connection (the gateway
    // won't auto-wake a suspended pod).
    await page.goto(`/pods/${slug}`);
    await expect(page.getByText(/is suspended/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: /Resume/i })).toBeVisible();
    await expect(page.locator(".term-state-connected")).toHaveCount(0);
  });
});
