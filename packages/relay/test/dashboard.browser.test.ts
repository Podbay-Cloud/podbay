import { afterAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { fixtureData, serveDashboard, type DashboardFixture } from "../src/dashboard.js";

// Probe the browser ONCE at collection time. A fresh clone without `npx playwright install`,
// or a prebaked browser whose version has drifted from the resolved playwright, cannot launch —
// skip the browser suite gracefully instead of hard-failing all of `npm test`. The non-browser
// tests still cover the dashboard's logic; these add real-DOM coverage only when a browser exists.
let browser: Browser | undefined;
try {
  browser = await chromium.launch(
    process.env.CI ? { headless: true, channel: "chrome" } : { headless: true },
  );
} catch {
  browser = undefined;
}
// Driving a REAL browser (CI uses channel: "chrome") on a cold runner takes far longer than
// vitest's 5s default — the suite went red at 5000ms while doing legitimate work. The
// prebaked headless shell finishes the same test in under a second locally.
const BROWSER_TEST_TIMEOUT_MS = 30_000;
const closes: Array<() => void> = [];
afterAll(async () => { closes.forEach((close) => close()); await browser?.close(); });

async function fixture(name: DashboardFixture = "active") {
  const server = await serveDashboard(0, { preview: true, fixture: name });
  closes.push(server.close);
  const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(server.url, { waitUntil: "networkidle" });
  return page;
}

describe.skipIf(!browser)("relay dashboard browser flows", () => {
  it("filters and expands activity, preserves tab URLs, and follows keyboard tab behavior", async () => {
    const page = await fixture();
    await page.locator("#tab-events").click();
    expect(new URL(page.url()).hash).toBe("#events");
    // Outcome is a checkbox group now, not a native <select>. "Blocked" covers owner- and
    // safety-blocked; the active fixture has exactly one safety-blocked event.
    await page.locator('.check[data-k="blocked"]').click();
    expect(await page.locator(".event").count()).toBe(1);
    // Selecting a filter surfaces a removable active-filter chip above the table.
    expect(await page.locator('#activeFilters .filter-chip').first().textContent()).toContain("Blocked");
    await page.locator(".event").click();
    expect(await page.locator(".event-detail").isVisible()).toBe(true);
    await page.locator("#tab-events").focus();
    await page.keyboard.press("ArrowRight");
    // WAIT for the hash rather than reading it straight after the keypress: the roving-tabindex
    // handler updates location asynchronously, so asserting immediately is a race the fast
    // local headless shell wins and real Chrome (CI) loses. Tabs are Overview·Live·Events·Controls,
    // so ArrowRight from Events lands on Controls.
    await page.waitForFunction(() => location.hash === "#controls");
    expect(new URL(page.url()).hash).toBe("#controls");
    expect(await page.locator("[data-tab-panel]:visible").count()).toBe(1);
    await page.close();
  }, BROWSER_TEST_TIMEOUT_MS);

  it("requires exact-scope confirmations for local controls and reports state in text", async () => {
    const page = await fixture();
    page.on("dialog", (dialog) => dialog.accept());
    // Pod pause/resume moved from the (removed) Pods tab into Controls → "Pod access".
    await page.getByRole("tab", { name: /Controls/ }).click();
    await page.getByRole("button", { name: "Pause" }).first().click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes("Paused"));
    expect(await page.getByRole("status").textContent()).toContain("Paused");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes("cleared"));
    expect(await page.getByRole("status").textContent()).toContain("cleared");
    await page.getByRole("button", { name: "Stop relay" }).click();
    await page.waitForFunction(() => document.querySelector("#stateTitle")?.textContent === "Relay stopped");
    expect(await page.locator("#stateTitle").textContent()).toBe("Relay stopped");
    await page.close();
  }, BROWSER_TEST_TIMEOUT_MS);

  it("has no horizontal overflow and retains primary semantics at 375px", async () => {
    const server = await serveDashboard(0, { preview: true, fixture: "large" });
    closes.push(server.close);
    const page = await browser.newPage({ viewport: { width: 375, height: 820 } });
    await page.goto(server.url, { waitUntil: "networkidle" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    expect(await page.locator("#stateTitle").textContent()).toContain("Relay");
    await page.locator("#tab-events").click();
    expect(await page.locator(".pod-chip").first().isVisible()).toBe(true);
    expect(await page.locator(".outcome").first().isVisible()).toBe(true);
    await page.close();
  }, BROWSER_TEST_TIMEOUT_MS);

  it("provides every required fixture state without external data", () => {
    expect(fixtureData("empty").events).toHaveLength(0);
    expect(new Set(fixtureData("healthy").events.map((event) => event.podId))).toEqual(new Set(["docs-indexer-31bc"]));
    expect(fixtureData("failures").events.every((event) => event.outcome !== "ok")).toBe(true);
    expect(fixtureData("signed-in").events.every((event) => event.session)).toBe(true);
    expect(fixtureData("legacy").events[0]?.podId).toBeUndefined();
    expect(fixtureData("stopped").state).toBe("stopped");
    expect(fixtureData("large").events).toHaveLength(600);
  });
});
