import { test, expect } from "@playwright/test";
import { login, launchPod } from "./helpers";

test.describe("dashboard shell + cards", () => {
  test("environments page shows the marketplace gallery", async ({ page }) => {
    await login(page, "approved");
    await page.goto("/dashboard/environments");
    await expect(page.locator('[data-testid=env-gallery]')).toBeVisible();
    // Workspaces is the default tab, so a workspace launch is visible up front.
    await expect(page.getByRole("tab", { name: "Workspaces" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("link", { name: /launch workspace/i }).first()).toBeVisible();
    // Switching to Playbooks reveals a playbook launch.
    await page.getByRole("tab", { name: "Playbooks" }).click();
    await expect(page.getByRole("link", { name: /start playbook/i }).first()).toBeVisible();
  });

  test("pods page links launching to the environments page (no env cards mixed in)", async ({
    page,
  }) => {
    await login(page, "approved");
    await page.goto("/dashboard");
    // No launch tiles on the pods page — launching goes to /dashboard/environments.
    await expect(page.locator('[data-testid=env-gallery]')).toHaveCount(0);
    // The content area (not just the sidebar) offers a launch entry to environments.
    await expect(
      page.locator('main a[href="/dashboard/environments"]').first(),
    ).toBeVisible();
  });

  test("legacy /new redirects to the environments page", async ({ page }) => {
    await login(page, "approved");
    await page.goto("/new");
    await expect(page).toHaveURL(/\/dashboard\/environments/);
  });

  test("sidebar user menu holds saved logins + sign out", async ({ page }) => {
    await login(page, "approved");
    await page.goto("/dashboard");
    await page.getByTestId('user-menu').click();
    await expect(page.getByRole("menuitem", { name: /sign out/i })).toBeVisible();
  });

  test("rename a pod on the cockpit persists across reload and shows on the card", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    await page.goto(`/dashboard/pods/${slug}`);
    await page.locator('[data-testid=cockpit-name]').click();
    const input = page.locator('[data-testid=cockpit-rename]');
    await input.fill("renamed by e2e");
    // Wait for the RENAME's own request to complete before navigating: a reload or
    // goto cancels an in-flight server action, and the write never lands. Matching
    // "a POST to /pods/<slug>" is not enough — the agent cards poll through server
    // actions, which post to the SAME url, so that matched a poll and the test
    // sailed on. The payload carries the new name, so match on that.
    const committed = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && (r.request().postData() ?? "").includes("renamed by e2e"),
    );
    await input.press("Enter");
    await expect(page.locator('[data-testid=cockpit-name]')).toContainText("renamed by e2e"); // optimistic
    await committed;

    await page.goto("/dashboard");
    await expect(page.locator('[data-testid=pod-card]', { hasText: "renamed by e2e" })).toBeVisible();

    await page.goto(`/dashboard/pods/${slug}`);
    await expect(page.locator('[data-testid=cockpit-name]')).toContainText("renamed by e2e"); // survives reload
  });

  test("card shows a live status dot and links to the cockpit", async ({ page }) => {
    await login(page, "approved");
    await launchPod(page);
    await page.goto("/dashboard");
    // The card shows the pod's NAME ("e2e-pod"), not the raw slug.
    const card = page.locator('[data-testid=pod-card]').filter({ hasText: "e2e-pod" }).first();
    await expect(card.getByTestId("pod-status")).toBeVisible();
    await card.click({ position: { x: 40, y: 20 } });
    // The card links to a real pod cockpit (a slug URL, not /new).
    await expect(page).toHaveURL(/\/dashboard\/pods\/[^/]+$/);
  });
});

test.describe("dashboard on mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no horizontal overflow; sidebar collapses to a burger drawer", async ({ page }) => {
    await login(page, "approved");
    await launchPod(page);
    await page.goto("/dashboard");

    const burger = page.getByRole("button", { name: /^menu$/i });
    await expect(burger).toBeVisible();

    // The page must not scroll horizontally on a phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Drawer opens and nav is reachable.
    await burger.click();
    await expect(page.locator('[data-testid=sidebar][data-drawer=open]')).toBeVisible();
    await expect(page.getByTestId('nav-link').filter({ hasText: 'Environments' })).toBeVisible();
  });

  test("tapping a pod card opens its cockpit on mobile", async ({ page }) => {
    await login(page, "approved");
    await launchPod(page);
    await page.goto("/dashboard");
    await page.locator('[data-testid=pod-card]').filter({ hasText: "e2e-pod" }).first().click({ position: { x: 40, y: 20 } });
    await expect(page).toHaveURL(/\/dashboard\/pods\/[^/]+$/);
  });
});

test.describe("landing page, signed in", () => {
  test("shows the user's avatar beside Dashboard without growing the nav row", async ({ page, browser }) => {
    // login() signs in through the real auth API using the PAGE's request context,
    // and it rejects the call once the page has navigated to an origin
    // ("MISSING_OR_NULL_ORIGIN"). So sign in first, and take the signed-out
    // baseline from a separate clean context rather than reordering this.
    await login(page, "approved");
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: /primary/i });
    const dash = nav.getByRole("link", { name: /Dashboard/ });
    await expect(dash).toBeVisible({ timeout: 20_000 });

    // The mark sits INSIDE the link: the account and the way back to it are one
    // target, not two things that happen to be adjacent.
    await expect(dash.locator("img, span").first()).toBeVisible();

    // "Did the row grow?" needs a real BEFORE, not a pixel threshold I picked — an
    // arbitrary bound is how a layout test passes while the layout is visibly wrong.
    // The avatar is taller than the text and deliberately overflows its row via a
    // negative margin; what must not change is the header row's height.
    const signedOut = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const anon = await signedOut.newPage();
    await anon.goto("/");
    const navOut = anon.getByRole("navigation", { name: /primary/i });
    await expect(navOut.getByRole("link", { name: "Sign in" })).toBeVisible({ timeout: 20_000 });
    const before = (await navOut.boundingBox())!.height;
    await signedOut.close();

    expect((await nav.boundingBox())!.height).toBeLessThanOrEqual(before);

    // …and it must be vertically centred with its siblings, not shifted.
    const sibling = nav.getByRole("link", { name: /Why Podbay/ }).first();
    const [a, b] = [(await dash.boundingBox())!, (await sibling.boundingBox())!];
    expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))).toBeLessThan(2);
  });
});
