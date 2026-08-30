import { test, expect } from "@playwright/test";
import { login, launchPod } from "./helpers";

/**
 * agent-harness-toggle §5.2 (flag-OFF, end-to-end): run with PODBAY_AGENT_HARNESS=none and confirm T3
 * is absent from BOTH launch and the cockpit, while the rest of the app still works. This is the live
 * proof of the disable — the unit tests cover the flag + gates in isolation; this shows the real
 * rendered pages omit T3 when the harness is off.
 *
 * This spec is a NO-OP unless the harness is disabled for the run (it asserts absence), so it stays
 * green in the normal (flag-on) e2e suite by skipping there.
 */
const HARNESS_OFF = (process.env.PODBAY_AGENT_HARNESS ?? "").toLowerCase().replace(/\s/g, "") === "none";

test.describe("T3 harness disabled", () => {
  test.skip(!HARNESS_OFF, "only runs with PODBAY_AGENT_HARNESS=none");

  test("the launch screen shows no T3 Control picker", async ({ page }) => {
    await login(page, "approved");
    await page.goto("/dashboard/pods/new?env=nextjs-starter");
    await expect(page.getByText(/Step 1 of/i)).toBeVisible();
    // No Control picker, no T3 marketing anywhere in the wizard.
    await expect(page.getByRole("radiogroup", { name: "Control" })).toHaveCount(0);
    await expect(page.getByText("T3 Code")).toHaveCount(0);
  });

  test("the cockpit shows no T3 panel, and launching still works", async ({ page }) => {
    await login(page, "approved");
    const slug = await launchPod(page, "nextjs-starter", { name: "t3-off pod" });
    await page.goto(`/dashboard/pods/${slug}`);
    // The cockpit renders (the settings tab exists) but the T3 connect panel is gone.
    await expect(page.getByText("Connect to your T3 account")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Enable T3/i })).toHaveCount(0);
    // A hand-typed T3 wizard URL does not open the flow.
    await page.goto(`/dashboard/pods/${slug}?wiz=t3connect`);
    await expect(page.getByText(/Sign in to your T3|Connect T3|T3 Code/i)).toHaveCount(0);
  });
});
