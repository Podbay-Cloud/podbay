import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("access gating", () => {
  test("anonymous is redirected from gated pages to sign-in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("landing shows the GitHub sign-in CTA", async ({ page }) => {
    await page.goto("/");
    // Match the CTA by DESTINATION, not its label: the headline CTA is positioning copy
    // (it has been "request alpha access" and is now "Give Claude a real home"), so asserting
    // the words makes this fail on every copy change while testing nothing about access.
    const cta = page.locator('a[href="/signin"]').first();
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/signin/);
  });

  test("landing sends an authenticated user to the dashboard", async ({ page }) => {
    await login(page, "approved");
    await page.goto("/");
    const cta = page.getByRole("link", { name: /open dashboard/i }).first();
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("sign-in presents the alpha access path and returns to the landing page", async ({ page }) => {
    await page.goto("/signin");
    await expect(page).toHaveTitle(/sign in to podbay/i);
    await expect(page.getByRole("heading", { name: "Sign in to Podbay" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
    await expect(page.getByText(/new requests join the private-alpha queue/i)).toBeVisible();
    await page.getByRole("link", { name: "Back to home" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("sign-in preserves a local callback and recovers when OAuth initiation fails", async ({ page }) => {
    let releaseRequest: (() => void) | undefined;
    await page.route("**/api/auth/sign-in/social", async (route) => {
      await new Promise<void>((resolve) => { releaseRequest = resolve; });
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "temporarily unavailable" }),
      });
    });

    await page.goto("/signin?next=%2Fnew%3Fenv%3Dautomation");
    const requestPromise = page.waitForRequest((request) =>
      request.url().includes("/api/auth/sign-in/social"),
    );
    const button = page.locator('form button[type="submit"]');
    await button.focus();
    await page.keyboard.press("Enter");
    const request = await requestPromise;

    await expect(button).toBeDisabled();
    await expect(button).toHaveText("Connecting to GitHub…");
    expect(request.postDataJSON()).toMatchObject({
      provider: "github",
      callbackURL: "/new?env=automation",
    });

    releaseRequest?.();
    await expect(page.getByText("GitHub sign-in could not start. Please try again.")).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(button).toHaveText("Continue with GitHub");
  });

  test("sign-in remains readable without horizontal overflow on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/signin");
    await expect(page.getByRole("heading", { name: "Sign in to Podbay" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test("landing has no horizontal overflow on a phone", async ({ page }) => {
    // The example TABS this used to drive belonged to the outcomes landing
    // (landing-examples.tsx), retired when agent-computer became the sole page. The
    // durable invariant — the landing never scrolls sideways on a small phone — survives
    // any positioning change, so that is what this now asserts.
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test("landing respects reduced motion and exposes outcome-led metadata", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    // Positioning copy is under an A/B experiment, so asserting the marketing
    // sentence makes this test fail every time we test a new headline. Assert the
    // invariants instead: we are Podbay, and the page HAS a description.
    await expect(page).toHaveTitle(/podbay/i);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{40,}/);
    // The auto-advancing example tabs went with the outcomes landing. The reduced-motion
    // invariant that remains testable without them: nothing animates the page into a
    // different scroll position, and the CTA is still reachable after the old rotate window.
    const cta = page.locator('a[href="/signin"]').first();
    await expect(cta).toBeVisible();
    await page.waitForTimeout(4500);
    await expect(cta).toBeVisible();
  });

  test("an unapproved user lands on the pending gate, not the dashboard", async ({ page }) => {
    await login(page, "pending");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/pending/);
    await page.goto("/new");
    await expect(page).toHaveURL(/\/pending/);
  });

  test("an approved user reaches the dashboard", async ({ page }) => {
    await login(page, "approved");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    // The dashboard shell renders (sidebar nav is always present for an approved user).
    await expect(page.getByTestId('nav-link').filter({ hasText: 'Environments' })).toBeVisible();
  });

  test("a non-admin cannot reach the admin page", async ({ page }) => {
    await login(page, "approved");
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin$/);
  });

  test("an admin can reach the admin page", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin/);
  });
});
