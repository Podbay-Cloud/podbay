import { test, expect } from "@playwright/test";

/**
 * The image-update dialog UI.
 *
 * The full behind→confirm→progress→rollback flow is gated on a real pin-vs-digest
 * mismatch that the fake stack doesn't produce, and forcing it globally gives every pod
 * an "update available" banner — enough blast radius to destabilise unrelated specs. So
 * the flow's *decision + progress* stay unit-covered, and the owner-facing UI — the
 * changelog dialog and the "what updating does" explainer — is exercised here via the
 * component harness (`/dev-harness/update`, dev-only, unauthenticated), with realistic
 * multi-build notes. See docs/plans/e2e-coverage-plan.md (area 5) for the deferred piece.
 */
test.describe("update dialog", () => {
  test("the changelog dialog opens, lists the builds, and confirms", async ({ page }) => {
    await page.goto("/dev-harness/update");
    await page.getByTestId("open-update").click();

    // The dialog shows what's in the update — the changelog across the build range.
    await expect(page.getByText(/What.?s in this update/i)).toBeVisible();
    await expect(page.getByText(/crash markers|the policy layer|OOM detection/i).first()).toBeVisible();

    // Confirming fires onConfirm and closes the dialog.
    await page.getByRole("button", { name: /Update and restart/i }).click();
    await expect(page.getByText(/What.?s in this update/i)).toHaveCount(0);
  });

  test("the 'what updating does' explainer opens", async ({ page }) => {
    await page.goto("/dev-harness/update");
    // UpdateBasicsDialog — the ⓘ that says what an update keeps/interrupts.
    await page.getByRole("button", { name: /What does updating do\?/i }).click();
    await expect(page.getByText("What updating does")).toBeVisible();
    await expect(page.getByText(/what.?s kept, and what to expect/i)).toBeVisible();
  });
});
