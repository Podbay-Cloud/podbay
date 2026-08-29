import { test, expect } from "@playwright/test";
import { login, launchPod, scriptPodHealth } from "./helpers";

/**
 * rc-reconnect-hardening §5.2: proves the 5-state Claude RC classification (rc-state.ts)
 * actually reaches the cockpit through the REAL product path — the pod-agent health payload
 * (`rcState`, protocol.ts) → `agentCardState`'s mapping (agent-card-state.ts) →
 * agent-cards.tsx's rendering → the `restoreRemoteControl` action (lib/actions.ts →
 * control-plane's `restoreRemoteControl`, service.ts) — against the FAKE provider stack.
 *
 * SIMULATED, by design (§5.3): `fake-provider.ts` lets a test script `rcState` directly and
 * fakes the `/agent/rc-restore` curl response — nothing here talks to a real pod-agent, an
 * Anthropic broker, or the Claude app. That real-infrastructure proof is the authenticated
 * CLI-pin matrix (openspec §1, `docs/runbooks/...` — a designated test pod, not this suite).
 */
test.describe("Claude RC lifecycle on the cockpit (simulated)", () => {
  test("down: Restore remote control replaces the old 'turning on…' catch-all, and a click restores it", async ({
    page,
  }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    // rcRestoreTo scripts what the FAKE /agent/rc-restore call reports back — see
    // fake-provider.ts's exec(): a real restore would reclassify the pod as active; this is
    // the simulated equivalent, driven entirely by the test.
    await scriptPodHealth(slug, { rcState: "down", rcRestoreTo: "active" });
    await page.goto(`/dashboard/pods/${slug}`);

    await expect(page.getByText(/remote control is down/i)).toBeVisible({ timeout: 25_000 });
    // The exact regression this change fixes: down used to fall into the same endless
    // "Signed in — turning on remote control…" text as every other non-linked state.
    await expect(page.getByText(/turning on remote control/i)).toHaveCount(0);

    const restore = page.getByRole("button", { name: /^restore remote control$/i });
    await expect(restore).toBeVisible();
    await restore.click();

    // Busy state: `restoringFor` is set SYNCHRONOUSLY inside the click handler, before the
    // network round-trip even starts (agent-cards.tsx's doRestoreRc), so it's already rendered
    // by the time Playwright's click() resolves — no artificial network delay needed to observe
    // it. The busy button also carries the disabled attribute, which IS the double-click guard.
    const busy = page.getByRole("button", { name: /restoring…/i });
    await expect(busy).toBeVisible();
    await expect(busy).toBeDisabled();

    // Reclassified from the OBSERVED result (rcRestoreTo scripts what the fake
    // /agent/rc-restore call reports) once the health query refetches — not assumed from the
    // request merely completing.
    await expect(page.getByRole("link", { name: /open in claude/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /restore remote control/i })).toHaveCount(0);
  });

  test("login-required: Reconnect is offered, never Restore and never the old catch-all", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    await scriptPodHealth(slug, { rcState: "login-required" });
    await page.goto(`/dashboard/pods/${slug}`);

    await expect(page.getByRole("button", { name: /reconnect claude/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("button", { name: /restore remote control/i })).toHaveCount(0);
    await expect(page.getByText(/turning on remote control/i)).toHaveCount(0);
  });

  test("recovering: bounded progress copy with the spin dot, no clickable action", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    await scriptPodHealth(slug, { rcState: "recovering" });
    await page.goto(`/dashboard/pods/${slug}`);

    const desc = page.getByText(/^restoring remote control…$/i);
    await expect(desc).toBeVisible({ timeout: 25_000 });
    // The Claude row's leading dot renders a spinning Loader2 for "recovering" (Dot's "spin"
    // tone) — the same element the "unknown" test below asserts must be ABSENT.
    await expect(desc.locator("..").locator(".animate-spin")).toHaveCount(1);

    await expect(page.getByRole("button", { name: /restore remote control/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /reconnect claude/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /open in claude/i })).toHaveCount(0);
  });

  test("unknown: honest 'couldn't be verified' copy — never a spinner, never a success-looking state", async ({
    page,
  }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    await scriptPodHealth(slug, { rcState: "unknown" });
    await page.goto(`/dashboard/pods/${slug}`);

    const desc = page.getByText(/remote control status couldn.t be verified/i);
    await expect(desc).toBeVisible({ timeout: 25_000 });
    await expect(desc.locator("..").locator(".animate-spin")).toHaveCount(0);

    await expect(page.getByRole("link", { name: /open in claude/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /restore remote control/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /reconnect claude/i })).toHaveCount(0);
  });

  test("active (unscripted, today's default): claude-linked is unchanged by this whole change", async ({
    page,
  }) => {
    // Light regression check, not new behavior — no rcState scripted at all, matching what
    // every pre-existing e2e spec that never mentions rcState already gets.
    await login(page, "approved");
    const slug = await launchPod(page);
    await page.goto(`/dashboard/pods/${slug}`);

    await expect(page.getByRole("link", { name: /open in claude/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("button", { name: /restore remote control/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /reconnect claude/i })).toHaveCount(0);
  });
});
