import { test, expect } from "@playwright/test";
import { login, launchPod, scriptPodGithub, waitForPodReady } from "./helpers";

/**
 * Add-GitHub-to-a-pod: connect → choose repo → clone into ~/work. The clone/overwrite
 * flow previously lived ONLY in an assertion-light visual test; this is the functional
 * spec, and it covers BOTH branches — the empty-workspace clone (the common path) and
 * the non-empty overwrite confirm (which the visual test also captures).
 *
 * The real device-auth flow can't run headless, so the pod is scripted as already
 * connected (`scriptPodGithub gh:true`); `workEmpty` selects the branch.
 */
test.describe("github → clone into ~/work", () => {
  test("empty ~/work: choose a repo and clone with no overwrite prompt", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "approved");
    const slug = await launchPod(page);
    await waitForPodReady(page, slug);
    await scriptPodGithub(slug, { gh: true, workEmpty: true });

    await page.goto(`/dashboard/pods/${slug}/github`);
    // Connected → the choose-repo step.
    await expect(page.getByText(/Choose a repository/i)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /search your repositories/i }).click();
    await page.getByRole("option", { name: /octocat\/hello-world/i }).click();
    await page.getByRole("button", { name: /clone to ~\/work/i }).click();

    // Empty workspace → clones straight away, NO "Replace ~/work" destructive prompt.
    await expect(page.getByText(/cloned octocat\/hello-world into ~\/work/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^replace ~\/work$/i })).toHaveCount(0);
  });

  test("non-empty ~/work: clone is gated behind a Replace confirm", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "approved");
    const slug = await launchPod(page);
    await waitForPodReady(page, slug);
    await scriptPodGithub(slug, { gh: true, workEmpty: false });

    await page.goto(`/dashboard/pods/${slug}/github`);
    await page.getByRole("button", { name: /search your repositories/i }).click();
    await page.getByRole("option", { name: /octocat\/hello-world/i }).click();
    await page.getByRole("button", { name: /clone to ~\/work/i }).click();

    // Non-empty → a distinct destructive confirm before anything is overwritten.
    const replace = page.getByRole("button", { name: /^replace ~\/work$/i });
    await expect(replace).toBeVisible({ timeout: 30_000 });
    await replace.click();
    await expect(page.getByText(/cloned octocat\/hello-world into ~\/work/i)).toBeVisible({ timeout: 30_000 });
  });
});
