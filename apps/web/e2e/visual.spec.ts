import { test, expect } from "@playwright/test";
import { login, launchPod, scriptPodGithub, waitForPodReady, resetWalkthroughSeen } from "./helpers";
import { USERS } from "./users";

const OUT = process.env.VISUAL_OUT || "/tmp/visual";

// Capture screenshots of the cockpit walkthrough + the terminal stats bar so the
// placement can actually be eyeballed (not just asserted). Run with a wide viewport.
test("VISUAL walkthrough + terminal stats", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 950 });
  await login(page, "approved");
  // The tour is per-user now; clear the flag so it shows for this capture run.
  await resetWalkthroughSeen(USERS.approved.email);
  const slug = await launchPod(page);

  // Cockpit — capture EVERY walkthrough step so each arrow→target can be checked.
  await page.goto(`/dashboard/pods/${slug}`);
  const tour = page.getByTestId("connect-walkthrough");
  await tour.waitFor({ state: "visible", timeout: 60_000 });
  for (let i = 1; i <= 6; i++) {
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${OUT}/wt-step${i}.png` });
    const next = tour.getByRole("button", { name: /^next$/i });
    if (await next.isVisible().catch(() => false)) await next.click();
    else break;
  }

  // Terminal — the stats bar. Sweep the width down: at every width the pod name must
  // stay whole (never ellipsed) and the stats strip must hide cleanly (not clip to a
  // stump) once there's no room. Screenshot each width so it can be eyeballed.
  await page.goto(`/pods/${slug}`);
  await page.waitForTimeout(2500);
  for (const w of [1440, 1180, 1000, 860, 720]) {
    await page.setViewportSize({ width: w, height: 950 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/terminal-w${w}.png`, clip: { x: 0, y: 0, width: w, height: 120 } });
  }

  // The name-never-ellipses guarantee, forced: inject a long pod name, then nudge the
  // width so the strip re-measures. The name must show in full (flex-shrink 0) and the
  // stats must be gone — the name is never the thing that gives.
  await page.setViewportSize({ width: 1000, height: 950 });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const pod = document.querySelector(".term-pod");
    if (pod) pod.textContent = "a-deliberately-very-long-pod-name.makore.app (dual-beefy-x2)";
  });
  await page.setViewportSize({ width: 980, height: 950 }); // nudge → ResizeObserver → re-measure
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/terminal-longname.png`, clip: { x: 0, y: 0, width: 980, height: 120 } });
});

test("VISUAL mobile — launch wizard, walkthrough, github wizard", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "approved");

  // Launch wizard on a phone.
  await page.goto("/dashboard/pods/new?env=doc-qa");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/launch-mobile.png`, fullPage: true });

  // A pod's cockpit → the connect walkthrough, EVERY step, on a phone.
  const slug = await launchPod(page);
  // The walkthrough is PER-USER and once-ever, and both visual tests share the "approved" user —
  // so the wide-viewport test above consumes it and this one finds it already dismissed. Reset it
  // here too, exactly as that test and cockpit.spec.ts do.
  //
  // This surfaced only once resetWalkthroughSeen was FIXED: while it pointed at a dead DB port it
  // threw, so the first visual test failed outright and never got far enough to consume the tour.
  await resetWalkthroughSeen(USERS.approved.email);
  await page.goto(`/dashboard/pods/${slug}`);
  const tour = page.getByTestId("connect-walkthrough");
  await tour.waitFor({ state: "visible", timeout: 60_000 });
  for (let i = 1; i <= 6; i++) {
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${OUT}/wt-mobile-step${i}.png` });
    const next = tour.getByRole("button", { name: /^next$/i });
    if (await next.isVisible().catch(() => false)) await next.click();
    else break;
  }

  // The GitHub wizard page on a phone (404s if GitHub connect isn't configured here).
  await page.goto(`/dashboard/pods/${slug}/github`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/github-mobile.png`, fullPage: true });
});

// The confirmed OVERWRITE path: a non-empty ~/work refuses, then the explicit
// "Replace ~/work" confirm goes through. Scripts the pod as gh-connected with a
// non-empty workspace (the real device flow can't run headless).
test("VISUAL github → clone into a non-empty ~/work → confirm overwrite", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1100, height: 900 });
  await login(page, "approved");
  const slug = await launchPod(page);
  await waitForPodReady(page, slug); // the provider must have the pod before a clone (else 'not found')
  await scriptPodGithub(slug, { gh: true, workEmpty: false });

  await page.goto(`/dashboard/pods/${slug}/github`);

  // Connected → the choose-repo step. Pick a repo, then clone.
  await page.getByRole("button", { name: /search your repositories/i }).click();
  await page.getByRole("option", { name: /octocat\/hello-world/i }).click();
  await page.getByRole("button", { name: /clone to ~\/work/i }).click();

  // Non-empty → the confirm-overwrite panel (a distinct destructive prompt).
  const replace = page.getByRole("button", { name: /^replace ~\/work$/i });
  await replace.waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/github-overwrite-confirm.png`, fullPage: true });

  // Confirm → the forced clone succeeds.
  await replace.click();
  await page.getByText(/cloned octocat\/hello-world into ~\/work/i).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/github-overwrite-done.png`, fullPage: true });
});

// Launch-wizard tweaks: (1) a name is now REQUIRED (Next is gated on basics),
// (2) typed secret values survive a reload (sessionStorage draft), (4) the Review
// step shows the size as text + machine specs (not a bare "s").
test("VISUAL launch wizard — name required, secret persists, review size", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1100, height: 950 });
  await login(page, "approved");
  await page.goto("/dashboard/pods/new?env=doc-qa");
  await page.waitForLoadState("networkidle");

  // Basics: name required — Next is disabled until it's filled.
  await expect(page.getByRole("button", { name: /^next$/i })).toBeDisabled();
  await page.screenshot({ path: `${OUT}/wizard-basics-required.png`, fullPage: true });

  await page.locator("#pod-name").fill("verify-pod");
  await expect(page.getByRole("button", { name: /^next$/i })).toBeEnabled();
  await page.getByRole("button", { name: /^next$/i }).click();

  // Settings: type a secret, reload → the value is still there (persisted draft).
  // Header is now the compact "Settings · 2 / 3" (not "Step 2 of 3 — Settings").
  await expect(page.getByText("2 / 3", { exact: true })).toBeVisible();
  await page.locator("#secret-ANTHROPIC_API_KEY").fill("sk-persist-check-123");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#secret-ANTHROPIC_API_KEY")).toHaveValue("sk-persist-check-123");
  await page.screenshot({ path: `${OUT}/wizard-secret-persisted.png`, fullPage: true });

  // Review: size renders as text + specs.
  await page.getByRole("button", { name: /^next$/i }).click();
  await expect(page.getByText(/Review & launch/i)).toBeVisible();
  await expect(page.getByText(/vCPU/)).toBeVisible(); // e.g. "Small — 2 vCPU · 4 GB RAM · 10 GB disk"
  await page.screenshot({ path: `${OUT}/wizard-review-size.png`, fullPage: true });
});

// The relay row's ⓘ — the owner's one explanation of what the relay does and its limits.
test("VISUAL cockpit relay ⓘ explains the relay", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1100, height: 950 });
  await login(page, "approved");
  const slug = await launchPod(page);
  await page.goto(`/dashboard/pods/${slug}?tab=settings`);
  const tour = page.getByTestId("connect-walkthrough");
  if (await tour.isVisible().catch(() => false)) {
    const done = tour.getByRole("button", { name: /^(done|next)$/i });
    for (let i = 0; i < 7 && (await done.isVisible().catch(() => false)); i++) await done.click();
  }
  await page.getByRole("button", { name: /what is the relay/i }).click();
  await page.getByText(/not an anonymous proxy/i).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: `${OUT}/relay-info.png`, fullPage: true });
});
