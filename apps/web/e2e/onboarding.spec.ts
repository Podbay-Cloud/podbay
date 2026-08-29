import { test, expect } from "@playwright/test";
import { login, launchPod } from "./helpers";

/**
 * The onboarding hero — the guided setup a pod shows BEFORE it's ready. Normally
 * `PODBAY_FAKE_SESSION_URL` makes fake pods reach ready instantly, so this whole surface
 * was untested. A pod NAMED with the NO-SESSION sentinel never gets a session URL, so it
 * stays in the "login" phase (deriveSetupStep) and the sign-in hero renders.
 *
 * What's covered: the guided-setup hero is REACHED (a pod without a session does NOT skip
 * to the ready cockpit) and it advances through the setup phases, durably across reload.
 * What's NOT (deferred, see docs/plans/e2e-coverage-plan.md area 8): the exact sign-in
 * step's auth-link → paste-code → submit, and the live AgentCards sign-in states. Those
 * are driven by the pod-agent greeter's control frames (auth URL, authed) — the fake
 * stack runs a real pod-agent that reports "authed", so the pure "login" step can't be
 * held without simulating those frames. Bounded here to the hero being reached.
 */
test.describe("onboarding hero", () => {
  test("a pod without a session shows guided setup, not the ready cockpit", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    await launchPod(page, "nextjs-starter", { name: "NO-SESSION onboarding" });

    // It sits in guided setup — the wizard progress rail + a setup phase card — rather
    // than the ready control room.
    await expect(page.getByText(/Building your machine|Sign in to|Starting your agent/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/^Ready$/).first()).toBeVisible(); // the progress rail's final step
    // Crucially it has NOT jumped to the ready cockpit — no tab strip.
    await expect(page.getByRole("tab", { name: /settings/i })).toHaveCount(0);

    // The phase is server-derived, so a reload stays in guided setup (a pod with no
    // session never advances to ready).
    await page.reload();
    await expect(page.getByText(/Building your machine|Sign in to|Starting your agent/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("tab", { name: /settings/i })).toHaveCount(0);
  });

  test("the Claude sign-in step shows the auth link and accepts a pasted code", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    const slug = await launchPod(page, "nextjs-starter", { name: "NO-SESSION signin" });

    // The pod routes to the UNAUTHED agent, so it holds in the sign-in step.
    await expect(page.getByText(/Sign in to Claude/i)).toBeVisible({ timeout: 30_000 });

    // Simulate the greeter emitting the Claude sign-in URL (what the gateway scrapes from a
    // real login). The cockpit polls the pod's authUrl, so the link appears without a reload.
    const res = await page.request.post("/api/e2e/record-auth-url", {
      data: { slug, url: "https://claude.ai/oauth/authorize?e2e=1" },
    });
    expect(res.ok()).toBeTruthy();

    // The sign-in link renders (from the injected auth URL)…
    const link = page.getByRole("link", { name: /Open the Claude sign-in page/i });
    await expect(link).toBeVisible({ timeout: 20_000 });
    await expect(link).toHaveAttribute("href", /claude\.ai\/oauth/);

    // …and the paste-a-code control accepts a code and reports it sent (typed into the PTY).
    // Placeholder is "Paste the code here" (paste-code-input.tsx's default); the spec still looked
    // for the older "Authorization code" wording and waited 90s for an input that never matched.
    await page.getByPlaceholder(/Paste the code/i).fill("e2e-auth-code-123");
    await page.getByRole("button", { name: /^Submit code$/i }).click();
    await expect(page.getByRole("button", { name: /Sent ✓/ })).toBeVisible({ timeout: 10_000 });
  });

  test("the Codex sign-in step shows the device code and OpenAI link", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    // Codex as the PRIMARY agent (agents:["codex"]) → the cockpit shows the Codex step.
    // NO-SESSION keeps it on the unauthed agent so it holds pre-login.
    const slug = await launchPod(page, "nextjs-starter", { name: "NO-SESSION codex", agent: "codex" });

    await expect(page.getByText(/Sign in to Codex/i)).toBeVisible({ timeout: 30_000 });

    // For a Codex pod the "auth URL" field carries the DEVICE CODE (the gateway scrapes it
    // from `codex/device` output). Inject it the same way the greeter would surface it.
    const res = await page.request.post("/api/e2e/record-auth-url", {
      data: { slug, url: "E2E-CODE-4242" },
    });
    expect(res.ok()).toBeTruthy();

    // The code renders, alongside the static OpenAI device link.
    await expect(page.getByText("E2E-CODE-4242").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: /Open OpenAI sign-in/i })).toHaveAttribute(
      "href",
      /auth\.openai\.com\/codex\/device/,
    );
  });
});
