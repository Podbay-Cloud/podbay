import { describe, it, expect } from "vitest";
import { summarize } from "../src/audit.js";

const line = (o: Record<string, unknown>) => JSON.stringify({ ms: 0, session: false, ...o });

describe("audit summary", () => {
  it("accounts for EVERY request — ok + failed = total, no silent middle", () => {
    // The live bug: `ok` counted only 2xx–3xx and `refused` only transport errors, so a
    // 403 block page was NEITHER. The owner saw "40 fetches, 34 ok, 0 refused" and could
    // not tell what the other 6 did.
    const s = summarize(
      [
        line({ host: "a.com", status: 200 }),
        line({ host: "b.com", status: 403 }), // the site refused us
        line({ host: "c.com", status: 429 }), // rate-limited
        line({ host: "d.com", status: 500 }),
        line({ host: "e.com", status: 0, error: "could not connect" }),
      ].join("\n"),
    );
    expect(s.total).toBe(5);
    expect(s.ok).toBe(1);
    expect(s.failed).toBe(4);
    expect(s.ok + s.failed).toBe(s.total);
  });

  it("counts a site's failures per host, including refusing statuses", () => {
    const s = summarize([line({ host: "x.com", status: 200 }), line({ host: "x.com", status: 403 })].join("\n"));
    const x = s.byHost.find((h) => h.host === "x.com")!;
    expect(x.count).toBe(2);
    expect(x.failed).toBe(1);
  });

  it("keeps TUNNEL connections separate from fetches, and sums bytes", () => {
    const s = summarize(
      [
        line({ host: "site.com", status: 200 }), // a fetch
        line({ host: "site.com", status: 200, kind: "tunnel", bytes: 2048 }),
        line({ host: "site.com", status: 200, kind: "tunnel", bytes: 1024 }),
      ].join("\n"),
    );
    expect(s.tunnelConnections).toBe(2);
    expect(s.tunnelBytes).toBe(3072);
    const h = s.byHost.find((x) => x.host === "site.com")!;
    expect(h.count, "tunnel connections must not inflate the fetch count").toBe(1);
    expect(h.tunnel).toBe(2);
    expect(h.bytes).toBe(3072);
  });

  it("a refused tunnel connection counts as failed", () => {
    const s = summarize(line({ host: "lan", status: 0, kind: "tunnel", error: "target not allowed" }));
    expect(s.failed).toBe(1);
    expect(s.ok).toBe(0);
  });

  it("rows written before tunnelling existed still read as fetches", () => {
    const s = summarize(line({ host: "old.com", status: 200 })); // no `kind`
    expect(s.byHost[0]!.count).toBe(1);
    expect(s.tunnelConnections).toBe(0);
  });

  it("marks a session (fetched as you) host", () => {
    const s = summarize(line({ host: "acc.com", status: 200, session: true }));
    expect(s.sessionFetches).toBe(1);
    expect(s.byHost[0]!.session).toBe(true);
  });
});
