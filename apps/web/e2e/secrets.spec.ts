import { test, expect, type Page } from "@playwright/test";
import { login, launchPod, scriptPodSecretRequests } from "./helpers";

/** Dismiss the once-per-pod connect walkthrough if it's overlaying the panel. */
async function dismissWalkthrough(page: Page): Promise<void> {
  const tour = page.getByTestId("connect-walkthrough");
  if (await tour.isVisible({ timeout: 8000 }).catch(() => false)) {
    await tour.getByRole("button", { name: /^skip$/i }).click();
    await expect(tour).toBeHidden();
  }
}

/**
 * The Secrets tab beyond the `.env`-paste path: setting/replacing a single value,
 * Clear vs Delete, the required badge, and the agent-requested-secret callout.
 */
test.describe("secrets tab", () => {
  test("add an arbitrary variable, then delete it", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    const slug = await launchPod(page);
    await page.goto(`/dashboard/pods/${slug}?tab=secrets`);
    await dismissWalkthrough(page);
    await expect(page.getByRole("heading", { name: "Secrets" })).toBeVisible();

    await page.getByPlaceholder("NAME").fill("FOO_TEST");
    await page.getByPlaceholder(/Enter value/i).fill("alpha");
    await page.getByRole("button", { name: /^Add$/ }).click();

    // Adding an arbitrary var reloads the list — the row is the signal (no notice).
    await expect(page.getByText("FOO_TEST", { exact: true })).toBeVisible({ timeout: 20_000 });

    // An arbitrary (undeclared) var offers Delete, not Clear.
    const row = page.locator("li", { hasText: "FOO_TEST" });
    await row.getByRole("button", { name: /^Delete$/ }).click();
    const deleteDialog = page.getByRole("alertdialog");
    await expect(deleteDialog.getByRole("heading", { name: "Delete FOO_TEST?" })).toBeVisible();
    await deleteDialog.getByRole("button", { name: /^Delete$/ }).click();
    await expect(page.getByText("FOO_TEST", { exact: true })).toHaveCount(0, { timeout: 20_000 });
  });

  test("the eye reveals a stored value in-place and re-masks it", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    const slug = await launchPod(page);
    await page.goto(`/dashboard/pods/${slug}?tab=secrets`);
    await dismissWalkthrough(page);
    await expect(page.getByRole("heading", { name: "Secrets" })).toBeVisible();

    // Store a value, then prove the owner can reveal it in the masked field.
    await page.getByPlaceholder("NAME").fill("PEEK_TOKEN");
    await page.getByPlaceholder(/Enter value/i).fill("peekaboo-123");
    await page.getByRole("button", { name: /^Add$/ }).click();

    const row = page.locator("li", { hasText: "PEEK_TOKEN" });
    const field = row.getByLabel("PEEK_TOKEN value");
    // Masked by default — dots, never the value.
    await expect(field).toHaveValue(/•+/, { timeout: 20_000 });
    // Eye reveals the real value in the same field.
    await row.getByRole("button", { name: /show value/i }).click();
    await expect(field).toHaveValue("peekaboo-123", { timeout: 20_000 });
    // Eye again re-masks.
    await row.getByRole("button", { name: /hide value/i }).click();
    await expect(field).toHaveValue(/•+/);

    // Edit → empty editable input + Cancel returns to the masked field.
    await row.getByRole("button", { name: /^Edit$/ }).click();
    const editBox = row.getByPlaceholder(/New value/i);
    await expect(editBox).toBeEditable();
    await expect(editBox).toHaveValue("");
    await row.getByRole("button", { name: /^Cancel$/ }).click();
    await expect(field).toHaveValue(/•+/);

    // Edit → type → Save replaces the value.
    await row.getByRole("button", { name: /^Edit$/ }).click();
    await row.getByPlaceholder(/New value/i).fill("rotated-456");
    await row.getByRole("button", { name: /^Save$/ }).click();
    await expect(row.getByRole("button", { name: /show value/i })).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: /show value/i }).click();
    await expect(row.getByLabel("PEEK_TOKEN value")).toHaveValue("rotated-456", { timeout: 20_000 });
  });

  test("a declared secret shows a masked field; Clear returns it to required", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    // doc-qa declares a required secret; launchPod fills it, so it arrives SET.
    const slug = await launchPod(page, "doc-qa");
    await page.goto(`/dashboard/pods/${slug}?tab=secrets`);
    await dismissWalkthrough(page);

    const row = page.getByRole("listitem").filter({
      has: page.getByText("ANTHROPIC_API_KEY", { exact: true }),
    });
    // First assertion after the tab loads — its siblings below use 20s, but this one had the
    // 5s default and occasionally lost the race on a loaded sequential run (flaky, passed on
    // retry). Match the others; the page render is the slow part, not a defect.
    await expect(row).toBeVisible({ timeout: 20_000 });
    // A set secret shows the masked field + eye (no "set" pill).
    await expect(row.getByRole("button", { name: /show value/i })).toBeVisible();
    await expect(row.getByText(/^set$/i)).toHaveCount(0);

    // Clear a DECLARED secret (Clear, not Delete) → its value-entry form returns.
    await row.getByRole("button", { name: /^Clear$/ }).click();
    const clearDialog = page.getByRole("alertdialog");
    await expect(
      clearDialog.getByRole("heading", { name: "Clear ANTHROPIC_API_KEY?" }),
    ).toBeVisible();
    await clearDialog.getByRole("button", { name: /^Clear$/ }).click();
    await expect(row.getByPlaceholder(/Enter value/i)).toBeVisible({ timeout: 20_000 });

    // Re-set it → back to a masked field.
    await row.getByPlaceholder(/Enter value/i).fill("sk-e2e-value");
    await row.getByRole("button", { name: /^Save$/ }).click();
    await expect(row.getByRole("button", { name: /show value/i })).toBeVisible({ timeout: 20_000 });
  });

  test("agent-requested secrets are surfaced as a callout", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    const slug = await launchPod(page);
    await scriptPodSecretRequests(slug, [
      { key: "STRIPE_KEY", description: "to charge test cards", at: "2026-08-05T00:00:00Z" },
    ]);
    await page.goto(`/dashboard/pods/${slug}?tab=secrets`);
    await dismissWalkthrough(page);

    await expect(page.getByText(/The agent is asking for these/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("STRIPE_KEY", { exact: true })).toBeVisible();
  });
});
