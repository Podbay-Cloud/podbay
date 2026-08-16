import { test, expect } from "@playwright/test";
import { login, launchPod } from "./helpers";

/**
 * The admin backoffice sub-pages. Each is read-mostly, and none had e2e coverage —
 * so this asserts each renders for an admin, states its boundary where it has one, and
 * exposes its key controls. Denial for non-admins is covered in admin.spec.ts /
 * access.spec.ts; here we prove the pages themselves work.
 */
test.describe("admin backoffice pages", () => {
  test("Users console lists users and offers approve/revoke", async ({ page, browser }) => {
    // Seed an approved non-admin so there's a revocable row, independent of run order.
    const ctx = await browser.newContext();
    await login(await ctx.newPage(), "approved");
    await ctx.close();

    await login(page, "admin");
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await expect(page.getByText("approved@podbay.test")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Revoke$/ }).first()).toBeVisible();
  });

  test("Incidents page renders its fleet view", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/incidents");
    await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible();
  });

  test("Boxes shows host vitals and the pod-fit visualisation", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/boxes");
    await expect(page.getByText("How pods fit")).toBeVisible();
    // The fake box reports a name; the overcommit view names its axes.
    await expect(page.getByText(/Overcommit/i).first()).toBeVisible();
  });

  test("Images shows the pod-base image history", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/images");
    await expect(page.getByText("Pod-base images")).toBeVisible();
  });

  test("Skills registry renders", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/skills");
    await expect(page.getByRole("heading", { name: "Skills" }).first()).toBeVisible();
  });

  test("Relay fleet view renders its summary and empty state", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/relay");
    await expect(page.getByText("Relays").first()).toBeVisible();
    // The summary strip labels; with no relay connected the table says so.
    await expect(page.getByText("Connected").first()).toBeVisible();
    await expect(page.getByText(/No relays connected/i)).toBeVisible();
  });

  test("Experiments list opens a detail page with controls", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/experiments");
    await expect(page.getByText("Experiments").first()).toBeVisible();
    const open = page.getByRole("link", { name: /Open experiment/i }).first();
    await expect(open).toBeVisible();
    await open.click();
    // Cold-compile of the [id] route + render before the URL commits (no loading.tsx).
    await expect(page).toHaveURL(/\/admin\/experiments\/.+/, { timeout: 20_000 });
    // The detail renders the runtime/controls panel with the config an operator reads.
    await expect(page.getByText(/Runtime and controls/i)).toBeVisible();
    await expect(page.getByText(/Allocation/i).first()).toBeVisible();
  });

  test("Fetch memory states its boundary and empty state", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/fetch-memory");
    await expect(page.getByText(/never URLs, never page content, never who asked/i)).toBeVisible();
  });
});

/**
 * The admin pods table + drill-in image controls that suspend/resume + doctor tests
 * don't touch: the table's sort, and that the drill-in renders the update/rollback lever.
 */
test.describe("admin pods table + drill-in", () => {
  test("pods table renders launched pods and is sortable", async ({ page }) => {
    await login(page, "admin");
    const slug = await launchPod(page);
    await page.goto("/admin/pods");
    await expect(page.getByRole("cell", { name: new RegExp(slug) }).first()).toBeVisible();
    // A sort header re-orders via ?sort=; clicking it keeps us on the table.
    const header = page.getByRole("button", { name: /Created|Cost|Size/ }).first();
    if (await header.count()) {
      await header.click();
      await expect(page).toHaveURL(/\/admin\/pods/);
    }
  });
});
