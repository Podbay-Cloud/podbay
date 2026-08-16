import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("environment detail", () => {
  test("tile → Details shows the capability summary and can launch", async ({ page }) => {
    await login(page, "approved");
    await page.goto("/dashboard/environments");

    const tile = page.locator("li", { hasText: "Ask Your Docs" });
    await tile.getByRole("link", { name: "View details", exact: true }).click();

    // Headroom for the dev server compiling this route on first visit (~3s observed);
    // the default 5s left about a second of slack and flaked in a full-suite run
    // while passing alone.
    await expect(page).toHaveURL(/\/dashboard\/environments\/doc-qa/, { timeout: 20_000 });
    await expect(page.getByText(/what.?s prepared/i)).toBeVisible();
    await expect(page.getByText("Claude Code")).toBeVisible();
    await expect(page.getByText("ANTHROPIC_API_KEY")).toBeVisible();

    // Launch leads to the new-pod wizard for this env.
    await page.getByRole("link", { name: /^launch$/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/pods\/new\?env=doc-qa/);
    // The heading carries the env's display TITLE ("Ask Your Docs"), not its id.
    await expect(page.getByRole("heading", { name: /new pod — ask your docs/i })).toBeVisible();
  });
});
