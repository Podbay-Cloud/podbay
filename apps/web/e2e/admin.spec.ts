import { test, expect } from "@playwright/test";
import { login, launchPod } from "./helpers";
import { USERS } from "./users";

test.describe("admin access requests", () => {
  test("admin sees a pending signup and can approve it", async ({ browser, page }) => {
    // A fresh user signs up (unapproved) in their own context.
    const applicant = `applicant-${Date.now()}@podbay.test`;
    const ctx = await browser.newContext();
    const applicantPage = await ctx.newPage();
    const res = await applicantPage.request.post("/api/auth/sign-up/email", {
      data: { email: applicant, password: "test-password-123", name: "Applicant" },
    });
    expect(res.ok()).toBeTruthy();
    // Unapproved → gated to /pending.
    await applicantPage.goto("/dashboard");
    await expect(applicantPage).toHaveURL(/\/pending/);

    // Admin approves them.
    await login(page, "admin");
    await page.goto("/admin");
    const row = page.locator("li", { hasText: applicant });
    await expect(row).toBeVisible();
    await expect(row.getByText(/pending/i)).toBeVisible();
    await row.getByRole("button", { name: /^approve$/i }).click();
    // /admin lists people WAITING for approval, so approving REMOVES the row — it
    // never flips to an "approved" label. (The real proof is the next assertion:
    // the applicant can now reach the dashboard.)
    await expect(row).toHaveCount(0, { timeout: 10_000 });

    // Now the applicant reaches the dashboard.
    await applicantPage.goto("/dashboard");
    await expect(applicantPage).toHaveURL(/\/dashboard/);
    await ctx.close();
  });

  test("a non-admin is denied every backoffice route", async ({ page }) => {
    await login(page, "approved");
    for (const route of ["/admin", "/admin/fleet"]) {
      await page.goto(route);
      await expect(page).not.toHaveURL(/\/admin/);
    }
    expect(USERS.approved.email).toBeTruthy();
  });

  test("the backoffice renders inside the shared sidebar with the admin menu", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin");

    // The shared shell chrome is present, carrying the admin destinations.
    await expect(page.getByTestId("sidebar")).toBeVisible();
    const navLinks = page.getByTestId("nav-link");
    await expect(navLinks.filter({ hasText: "Access requests" })).toBeVisible();
    // "Fleet" is not in the admin nav (it is Access requests / Users / Pods /
    // Boxes / Images / Skills / Experiments). Assert one that exists.
    await expect(navLinks.filter({ hasText: "Boxes" })).toBeVisible();
    await expect(navLinks.filter({ hasText: "Back to app" })).toBeVisible();

    // Active state follows the route: Access requests here, Fleet after navigating.
    await expect(navLinks.filter({ hasText: "Access requests" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Navigate to a section that IS in the nav — the test's point is that the
    // active-item marker follows navigation and the index doesn't stay active by
    // prefix match, not which section it is.
    await navLinks.filter({ hasText: "Boxes" }).click();
    await expect(page).toHaveURL(/\/admin\/boxes$/);
    await expect(navLinks.filter({ hasText: "Boxes" })).toHaveAttribute("aria-current", "page");
    // The index route must not stay active by prefix match.
    await expect(navLinks.filter({ hasText: "Access requests" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );

    // Back to app returns to the user dashboard.
    await navLinks.filter({ hasText: "Back to app" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("pods table on a phone: scrolls sideways, and a tap opens THAT pod", async ({ page }) => {
    // Both failures came from one stretched overlay on the <tr>: `position: relative`
    // on a table row is not a reliable containing block, so one row's link covered
    // the whole table (every tap opened the same pod) and it sat on top of the
    // scroll container, eating touch scrolling. Reported live 2026-07-29.
    await page.setViewportSize({ width: 390, height: 780 });
    await login(page, "admin");
    const slug = await launchPod(page, "nextjs-starter");
    await page.goto("/admin/pods");
    await expect(page.getByRole("cell", { name: new RegExp(slug) }).first()).toBeVisible({
      timeout: 20_000,
    });

    // The table must be horizontally scrollable, and actually scroll.
    const box = page.locator("div.overflow-x-auto").first();
    const geom = await box.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(geom.scroll, "table should overflow on a phone").toBeGreaterThan(geom.client);
    await box.evaluate((el) => {
      el.scrollLeft = 200;
    });
    expect(await box.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

    // A tap on a FAR cell of that row opens that pod — not whichever row is first.
    const row = page.locator("tbody tr", { hasText: slug });
    await row.locator("td").last().click();
    // Generous timeout: whichever test reaches /admin/pods/[id] FIRST pays for the
    // dev server to compile that route (~3.6s observed), and the default 5s left
    // ~1s of slack — so this flaked about one run in three while the click itself
    // was always correct. The server log showed the right pod being fetched while
    // the assertion was already timing out.
    await expect(page).toHaveURL(new RegExp(`/admin/pods/${slug}$`), { timeout: 20_000 });
  });

  test("the drill-in offers doctor and states each fact once", async ({ page }) => {
    await login(page, "admin");
    const slug = await launchPod(page);
    await page.goto(`/admin/pods/${slug}`);

    // ONE Resources card. Two shipped briefly — a live-polling one and a
    // server-rendered one, both titled "Resources", showing the same numbers from
    // different moments, so they visibly disagreed.
    await expect(page.getByText("Resources", { exact: true })).toHaveCount(1);

    // The operator can ACT, not just observe. adminRunDoctor existed with tests
    // and no button ever called it.
    await expect(page.getByRole("button", { name: "Run doctor" })).toBeVisible({ timeout: 20_000 });

    // Invasive repair is owner-only — it must not be offered here at all.
    await expect(page.getByRole("button", { name: /replaces files/i })).toHaveCount(0);

    // One verb for the irreversible action; "Destroy" was the operator's word for
    // the owner's "Delete", which makes a support conversation ambiguous.
    await expect(page.getByText(/Destroy/)).toHaveCount(0);
  });

  test("usage reads as a timeline with its window, for operator and owner alike", async ({ page }) => {
    await login(page, "admin");
    const slug = await launchPod(page);

    // Suspend, then resume — so there is a real awake→asleep→awake shape to draw
    // rather than one undivided bar.
    await page.goto(`/admin/pods/${slug}`);
    await page.getByRole("button", { name: "Suspend" }).click();
    await page.getByRole("button", { name: /^Suspend$/ }).last().click();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Resume" }).click();

    // The window is stated at BOTH ends, with the span — "since Jul 3" left the reader
    // to guess whether it ran to now, and gave no sense of scale. The timeline labels
    // each end UNDER the bar (a deliberate two-ends layout, not an arrow) and states the
    // running span in the legend.
    await expect(page.getByTestId("lifecycle-window")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/running/).first()).toBeVisible();

    // The owner sees the same picture, not a one-line summary.
    await page.goto(`/dashboard/pods/${slug}?tab=stats`);
    // Renders after launch→suspend→resume completes AND usage is recomputed — heavier late
    // in a sequential suite. 20s occasionally lost; 40s covers it without masking a defect.
    await expect(page.getByText("Running history")).toBeVisible({ timeout: 40_000 });
  });

  test("diagnostics are offered instead of a terminal, and say what they collect", async ({ page }) => {
    await login(page, "admin");
    const slug = await launchPod(page);
    await page.goto(`/admin/pods/${slug}`);

    // The operator's escalation past doctor is a bounded collection — never a shell
    // on someone else's pod. No terminal affordance may appear here.
    await expect(page.getByRole("button", { name: "Collect" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: /terminal/i })).toHaveCount(0);

    // The boundary is stated to the person clicking the button, not just in the
    // script: they are the one who should know what they are about to take.
    await expect(page.getByText(/Never file contents, secret values, or agent transcripts/)).toBeVisible();

    await page.getByRole("button", { name: "Collect" }).click();
    // Sections are NAMED and shown — an unlabelled dump would be indistinguishable
    // from a shell, which is what the whole argument rests on.
    await expect(page.getByText("disk-free", { exact: true })).toBeVisible({ timeout: 30_000 });
  });

  test("fetch memory is visible, re-checkable, and states its own boundary", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/fetch-memory");

    // The boundary belongs where an operator reads the table, not only in a design
    // doc — this is the surface that would make someone assume it holds URLs.
    await expect(page.getByText(/never URLs, never page content, never who asked/)).toBeVisible({
      timeout: 20_000,
    });

    // An empty fleet must say why it is empty rather than looking broken — and say
    // when rows WILL appear, so nobody concludes the feature is dead.
    await expect(page.getByText(/Nothing learned yet/)).toBeVisible();
    await expect(page.getByText(/next reconcile pass/)).toBeVisible();

    // And it is reachable from the admin nav, not just by typing the URL.
    await page.goto("/admin/pods");
    await expect(page.getByRole("link", { name: /Fetch memory/i })).toBeVisible();
  });
});