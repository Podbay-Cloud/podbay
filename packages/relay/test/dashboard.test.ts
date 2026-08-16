import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { serveDashboard } from "../src/dashboard.js";

const closes: Array<() => void> = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
});

describe("relay dashboard preview", () => {
  it("serves a realistic local-only command center fixture", async () => {
    const dashboard = await serveDashboard(0, { preview: true });
    closes.push(dashboard.close);

    const page = await fetch(dashboard.url);
    const html = await page.text();
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("access-control-allow-origin")).toBeNull();
    expect(html).toContain("Podbay relay");
    expect(html).toContain('role="tab"');
    // Activity split into two tabs: Live (in-flight) + Events (audit + filters).
    expect(html).toContain('data-tab="live"');
    expect(html).toContain('data-tab="events"');
    expect(html).toContain('data-tab="controls"');
    expect(html).not.toContain('data-tab="activity"');
    // Pods is not a nav destination — it's folded into the Events filter bar.
    expect(html).not.toContain('data-tab="pods"');
    expect(html).toContain('id="modeSeg"');
    expect(html).toContain('id="podMount"');
    expect(html).toContain("Full detail stays here");

    const data = await fetch(`${dashboard.url}/data`).then((response) => response.json()) as {
      preview: boolean;
      events: Array<{ podId?: string; outcome: string }>;
      active: unknown[];
    };
    expect(data.preview).toBe(true);
    expect(new Set(data.events.flatMap((event) => event.podId ? [event.podId] : [])).size).toBe(3);
    expect(data.events.some((event) => event.outcome === "safety-blocked")).toBe(true);
    expect(data.active).toHaveLength(2);
  });

  it("falls back to a free loopback port when the preferred port is occupied", async () => {
    const occupied = createServer((_req, res) => res.end("occupied"));
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    closes.push(() => occupied.close());
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind TCP");

    const dashboard = await serveDashboard(address.port, { preview: true });
    closes.push(dashboard.close);
    expect(new URL(dashboard.url).port).not.toBe(String(address.port));
    expect(new URL(dashboard.url).hostname).toBe("127.0.0.1");
  });
});
