import { test, expect } from "@playwright/test";
import { login, launchPod, scriptPodHealth, resetWalkthroughSeen } from "./helpers";
import { USERS } from "./users";

/**
 * Cockpit behaviours that regressed unnoticed because nothing exercised them:
 * tab switching, the health strip's silence when healthy, and the agent cards.
 */
test.describe("cockpit", () => {
  test("switching tabs keeps the tab strip in view, even tall panel → short one", async ({
    page,
  }) => {
    // The panels differ by hundreds of pixels (measured: Details ~1180px vs Stats
    // ~600px). Scroll past the shorter one's maximum and the container CLAMPS —
    // which reads as "the page jumped to the top". So the property worth asserting
    // is not "scroll didn't change" but "you can still see the tabs you clicked".
    await page.setViewportSize({ width: 900, height: 500 });
    await login(page, "approved");
    const slug = await launchPod(page);
    await page.goto(`/dashboard/pods/${slug}`);
    await expect(page.getByRole("tab", { name: /settings/i })).toBeVisible();

    const strip = page.getByRole("tab", { name: /settings/i });
    for (const [from, to] of [
      ["Details", "Stats"], // tall → short: the reported case
      ["Admin", "Stats"],
      ["Stats", "Details"],
    ] as const) {
      await page.getByRole("tab", { name: new RegExp(from, "i") }).click();
      await page.waitForTimeout(500);
      // Get to the bottom of the tall panel first — that's where the clamp bites.
      await page.evaluate(() => {
        const m = document.querySelector("main");
        if (m) m.scrollTop = m.scrollHeight;
      });
      await page.waitForTimeout(200);

      await page.getByRole("tab", { name: new RegExp(to, "i") }).click();
      await page.waitForTimeout(900); // smooth scroll settles

      const box = await strip.boundingBox();
      expect(box, `${from} → ${to}: tab strip vanished`).not.toBeNull();
      expect(
        box!.y,
        `${from} → ${to}: tab strip is off-screen at y=${box!.y}`,
      ).toBeGreaterThanOrEqual(0);
      expect(box!.y, `${from} → ${to}: tab strip pushed below the fold`).toBeLessThan(500);
    }
  });

  test("a healthy pod shows no health strip", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    await page.goto(`/dashboard/pods/${slug}`);
    await expect(page.getByRole("tab", { name: /admin/i })).toBeVisible();
    // Green is invisible: the strip's PRESENCE is the signal.
    await expect(page.locator("[role=status]")).toHaveCount(0);
  });

  test("an unhealthy pod SAYS so — the strip appears only when there is something to say", async ({
    page,
  }) => {
    await login(page, "approved");
    const slug = await launchPod(page);

    // Healthy first: the strip's ABSENCE is the happy path, so prove it starts absent.
    await page.goto(`/dashboard/pods/${slug}`);
    await expect(page.getByRole("tab", { name: /admin/i })).toBeVisible();
    await expect(page.locator("[role=status]")).toHaveCount(0);

    await scriptPodHealth(slug, {
      issues: [
        {
          id: "disk-critical",
          severity: "critical",
          title: "This pod is almost out of disk",
          detail: "Under 5% free on the pod's home volume.",
          fixable: true,
        },
        {
          // Per-agent problems belong on that agent's CARD, never in the strip.
          id: "agent-not-running:codex",
          severity: "warn",
          title: "Codex isn't running",
          detail: "Its terminal window is gone.",
          fixable: true,
          agent: "codex",
        },
      ],
    });

    await page.reload();
    const strip = page.locator("[role=status]");
    await expect(strip).toHaveCount(1, { timeout: 25_000 });
    await expect(strip).toContainText(/almost out of disk/i);
    await expect(strip, "an agent's problem must not be duplicated into the strip").not.toContainText(
      /Codex isn't running/i,
    );

    // …and it goes away again when the pod recovers.
    await scriptPodHealth(slug, null);
    await page.reload();
    await expect(page.locator("[role=status]")).toHaveCount(0, { timeout: 25_000 });
  });

  test("a signed-in-but-EXPIRING login offers a confirm-gated Reconnect in the Control tab", async ({
    page,
  }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    // Claude is signed in and working, but its login hard-expires in ~3 days — the state that used to
    // leave the dashboard ribbon ("reconnect soon in the Control tab") with no action to point to.
    await scriptPodHealth(slug, { expiresAt: Date.now() + 3 * 24 * 60 * 60 * 1000 });
    await page.goto(`/dashboard/pods/${slug}`);
    await expect(page.getByRole("tab", { name: /admin/i })).toBeVisible();

    const reconnect = page.getByRole("button", { name: /reconnect claude/i });
    await expect(reconnect).toBeVisible({ timeout: 25_000 });

    // It's confirm-gated (a reconnect interrupts the session), so a click opens the dialog — it does
    // NOT immediately sign the working agent out.
    await reconnect.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/still works/i);
    await expect(dialog, "the session-interrupt warning must be shown").toContainText(/interrupted/i);

    // Cancel leaves the signed-in agent exactly as it was.
    await dialog.getByRole("button", { name: /cancel/i }).click();
    await expect(dialog).toBeHidden();
    await expect(reconnect).toBeVisible();
  });

  test("the reconnect wizard stays open on a still-authed agent (does not bounce to the cockpit)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    const slug = await launchPod(page); // signed in / authed
    // Open the reconnect wizard the way the Control-tab Reconnect does (via ?wiz=). A reconnect starts
    // on a STILL-authed agent; the wizard must NOT read that initial `authed` as "done" and close before
    // the wipe (the bug where Reconnect just flashed back to the "Sign in to Claude" card).
    await page.goto(`/dashboard/pods/${slug}?wiz=reconnect:claude-code`);
    await expect(
      page.getByText(/Preparing a fresh sign-in|Getting .*sign-in link/i).first(),
      "the reconnect wizard should stay open, not bounce back to the cockpit",
    ).toBeVisible({ timeout: 20_000 });
  });

  test("the sign-in wizard surfaces the URL from the persisted pod row (fallback path)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    const slug = await launchPod(page, "nextjs-starter", { name: "NO-SESSION wiz" });
    await page.goto(`/dashboard/pods/${slug}?wiz=signin:claude-code`);
    // Inject the URL onto the POD ROW (not the live agent) — the wizard now reads getPodAuthUrl as a
    // fallback, so it surfaces even when the live scrape lags (the reconnect-hang class).
    const res = await page.request.post("/api/e2e/record-auth-url", {
      data: { slug, url: "https://claude.ai/oauth/authorize?wiz=1" },
    });
    expect(res.ok()).toBeTruthy();
    await expect(page.getByRole("link", { name: /Open the Claude sign-in page/i })).toHaveAttribute(
      "href",
      /claude\.ai\/oauth/,
      { timeout: 20_000 },
    );
  });

  test("doctor reports findings, and a fix marks them fixed", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page);
    await scriptPodHealth(slug, {
      doctor: {
        checked: 2,
        issues: [
          {
            id: "codex-runtime-missing",
            severity: "warn",
            title: "Codex remote control can't start",
            detail: "The daemon Codex pairing needs isn't installed on this pod.",
            fixed: false,
          },
          {
            id: "env-layer-incomplete",
            severity: "warn",
            title: "This pod is missing its environment's skills",
            detail: "Restoring replaces the skills folder.",
            fixed: false,
            invasive: true,
          },
        ],
      },
    });

    await page.goto(`/dashboard/pods/${slug}?tab=admin`);
    await expect(page.getByText(/Codex remote control can't start/i)).toBeVisible({
      timeout: 25_000,
    });
    // The invasive finding is labelled AND kept out of "fix what's safe".
    await expect(page.getByText(/replaces files/i).first()).toBeVisible();

    await page.getByRole("button", { name: /fix what's safe/i }).click();
    await expect(page.getByText("fixed").first()).toBeVisible({ timeout: 25_000 });
    // The invasive one is NOT fixed by the safe run — that is the whole guarantee.
    await expect(page.getByRole("button", { name: /repair \(replaces files\)/i })).toBeVisible();
  });

  test("connect walkthrough runs once PER USER, not per pod", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "approved");
    // Isolate: other tests share this user and may have already marked the tour seen.
    await resetWalkthroughSeen(USERS.approved.email);
    const slug = await launchPod(page);
    await page.goto(`/dashboard/pods/${slug}`);

    // The coach-mark tour appears at ready. Step through to the end and finish.
    const tour = page.getByTestId("connect-walkthrough");
    await expect(tour).toBeVisible({ timeout: 30_000 });
    await expect(tour.getByText(/\d \/ \d/)).toBeVisible();
    // Advance until only "Done" remains, then dismiss.
    for (let i = 0; i < 8; i++) {
      const nextBtn = tour.getByRole("button", { name: /^next$/i });
      if (await nextBtn.isVisible().catch(() => false)) await nextBtn.click();
      else break;
    }
    await tour.getByRole("button", { name: /^done$/i }).click();
    await expect(tour).toBeHidden();

    // Seen is persisted (per-user DB flag) — a reload does NOT re-run it.
    await page.reload();
    await expect(page.locator("[data-testid=cockpit-name]")).toBeVisible();
    await expect(page.getByTestId("connect-walkthrough")).toHaveCount(0);

    // And crucially: a BRAND-NEW pod for the same user does NOT re-run it — the whole
    // point of the per-user move (it used to re-pop on every new pod).
    const slug2 = await launchPod(page);
    await page.goto(`/dashboard/pods/${slug2}`);
    await expect(page.locator("[data-testid=cockpit-name]")).toBeVisible();
    await expect(page.getByTestId("connect-walkthrough")).toHaveCount(0);
  });

  test("Secrets is a tab, and pasting a .env sets several keys at once", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, "approved");
    const slug = await launchPod(page);

    // The Secrets tab deep-links and renders inline (no modal).
    await page.goto(`/dashboard/pods/${slug}?tab=secrets`);

    // This test is about Secrets, not onboarding. Dismiss the once-per-pod walkthrough
    // directly so it cannot sit over the panel while the form is exercised.
    const tour = page.getByTestId("connect-walkthrough");
    if (await tour.isVisible({ timeout: 8000 }).catch(() => false)) {
      await tour.getByRole("button", { name: /^skip$/i }).click();
      await expect(tour).toBeHidden();
    }

    await expect(page.getByRole("heading", { name: "Secrets" })).toBeVisible();
    const valueField = page.getByPlaceholder(/enter value/i);
    await expect(valueField).toBeVisible();

    // Paste a two-line .env into the value field → both valid keys are staged for
    // human review (not dumped as one value or silently saved). Dispatch a real paste
    // event so the component's onPaste handles it.
    await valueField.evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData("text", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, "FImport_bad=skip\nFOO_ONE=alpha\nBAR_TWO=beta # note");

    await expect(page.getByText(/2 variables ready to review/i)).toBeVisible();
    await expect(page.getByText(/Review 2 pasted variables/i)).toBeVisible();
    await page.getByRole("button", { name: /^Save all$/ }).click();

    // Only after the owner confirms do the two valid keys become stored rows.
    await expect(page.getByText(/Saved 2 variables/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("FOO_ONE", { exact: true })).toBeVisible();
    await expect(page.getByText("BAR_TWO", { exact: true })).toBeVisible();
  });
});
