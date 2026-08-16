import { describe, it, expect, beforeEach } from "vitest";
import { RelayRegistry, type RelayLink } from "../src/relay-registry.js";

let now = 1_000_000;
let reg: RelayRegistry;
const sent: string[] = [];
const link = (): RelayLink => ({ send: (p) => { sent.push(p); return true; }, close: () => { sent.push("CLOSED"); } });

const req = (over: Partial<{ id: string; domain: string; url: string }> = {}) => {
  const domain = over.domain ?? "reddit.com";
  return {
    id: over.id ?? "r1",
    podId: "pod-1",
    url: over.url ?? `https://${domain}/r/x`,
    domain,
  };
};

beforeEach(() => {
  now = 1_000_000;
  sent.length = 0;
  reg = new RelayRegistry(() => now);
});

/**
 * The relay borrows a person's identity and network. Every rule here defaults to
 * refusing, and the tests are written to catch the ways a "convenient" change would
 * quietly widen it.
 */
describe("pairing", () => {
  it("binds a code to one owner, once", () => {
    reg.mintPairingCode("owner-a", "ABC123");
    expect(reg.redeem("ABC123", link())?.ownerId).toBe("owner-a");
    // Spent — a code that worked cannot work twice.
    expect(reg.redeem("ABC123", link())).toBeNull();
  });

  it("spends a code even when it has EXPIRED", () => {
    // Otherwise a leaked code can be ground against: try it, learn it is expired,
    // and it is still sitting there for the next attempt.
    reg.mintPairingCode("owner-a", "OLD");
    now += 11 * 60_000;
    expect(reg.redeem("OLD", link())).toBeNull();
    now = 1_000_000;
    reg.mintPairingCode("owner-a", "OLD2");
    expect(reg.redeem("OLD", link())).toBeNull();
  });

  it("replaces an existing relay rather than racing it", () => {
    reg.mintPairingCode("o", "C1");
    reg.redeem("C1", link());
    reg.mintPairingCode("o", "C2");
    reg.redeem("C2", link());
    // Two machines answering the same fetch is not a feature.
    expect(sent).toContain("CLOSED");
  });
});

describe("when the owner's machine is asleep", () => {
  it("queues rather than failing — availability is intermittent by nature", () => {
    const out = reg.submit("o", req());
    expect(out).toMatchObject({ status: "queued", position: 1 });
    // It says WHY it is waiting, so an agent can report "pending on the relay"
    // rather than an unexplained stall.
    expect((out as { reason: string }).reason).toMatch(/not connected/);
    expect(sent).toHaveLength(0);
  });

  it("sends what piled up, in order, when the relay connects", () => {
    reg.submit("o", req({ id: "a" }));
    reg.submit("o", req({ id: "b" }));
    reg.mintPairingCode("o", "C");
    reg.redeem("C", link());
    expect(reg.pump("o")).toBe(2);
    expect(sent.map((s) => JSON.parse(s).id)).toEqual(["a", "b"]);
    expect(sent.map((s) => JSON.parse(s).source)).toEqual([{ podId: "pod-1" }, { podId: "pod-1" }]);
    expect(sent.every((s) => !("podId" in JSON.parse(s)))).toBe(true);
  });

  it("carries the gateway-resolved pod display name in the frame source when set", () => {
    reg.mintPairingCode("o", "C");
    reg.redeem("C", link());
    reg.submit("o", { id: "n1", podId: "pod-1", podName: "My Crawler", url: "https://reddit.com/a", domain: "reddit.com" });
    reg.pump("o");
    expect(JSON.parse(sent[sent.length - 1]!).source).toEqual({ podId: "pod-1", podName: "My Crawler" });
  });

  it("bounds the queue instead of growing forever", () => {
    for (let i = 0; i < 50; i++) reg.submit("o", req({ id: `q${i}` }));
    expect(reg.submit("o", req({ id: "overflow" })).status).toBe("refused");
  });

  it("reports state an agent can act on before it tries", () => {
    reg.submit("o", req());
    const s = reg.state("o");
    expect(s).toMatchObject({ connected: false, queued: 1 });
    expect(s.domains).toEqual(["reddit.com"]);
  });
});

describe("results", () => {
  it("routes a result back to the caller waiting on it", async () => {
    reg.mintPairingCode("o", "C");
    reg.redeem("C", link());
    reg.submit("o", req({ id: "x1" }));
    const got = new Promise((res) => reg.await("o", "pod-1", "x1", res));
    expect(reg.complete("o", { id: "x1", status: 200, body: "hello" })).toBe(true);
    expect(await got).toMatchObject({ status: 200, body: "hello" });
  });

  it("ignores a result nobody asked for", () => {
    // A relay must not be able to inject content for a request that was never made.
    expect(reg.complete("o", { id: "never-requested", status: 200, body: "evil" })).toBe(false);
  });
});

describe("pacing drains on its own", () => {
  it("keeps a paced request queued until its slot frees, then sends it", () => {
    reg.mintPairingCode("o", "C"); reg.redeem("C", link());
    for (let i = 0; i < 10; i++) reg.submit("o", { id: `x${i}`, podId: "p", url: "https://reddit.com/a", domain: "reddit.com" });
    reg.submit("o", { id: "held", podId: "p", url: "https://reddit.com/held", domain: "reddit.com" });

    sent.length = 0;
    expect(reg.pump("o")).toBe(0);
    expect(reg.pendingOwners()).toEqual(["o"]);

    now += 61_000;
    expect(reg.pump("o")).toBe(1);
    expect(reg.pendingOwners()).toEqual([]);
  });

  it("does not let one paced domain block a different one", () => {
    // Budgets are per domain, so a busy domain must not stall an idle one. The idle
    // one should go straight out — never even reaching the queue.
    reg.mintPairingCode("o", "C"); reg.redeem("C", link());
    for (let i = 0; i < 10; i++) reg.submit("o", { id: `r${i}`, podId: "p", url: "https://reddit.com/a", domain: "reddit.com" });
    expect(reg.submit("o", { id: "held", podId: "p", url: "https://reddit.com/held", domain: "reddit.com" }).status).toBe("queued");

    sent.length = 0;
    expect(reg.submit("o", { id: "other", podId: "p", url: "https://example.com/x", domain: "example.com" }).status).toBe(
      "dispatched",
    );
    expect(JSON.parse(sent[0]).id).toBe("other");
    // …and reddit's held request is still waiting, untouched by the other domain.
    expect(reg.pendingOwners()).toEqual(["o"]);
  });
});

describe("the audit's teeth — SSRF, result hijack, reconnect, leaks", () => {
  it("gates on the URL's real host, not the pod's claimed domain (SSRF)", () => {
    // A pod claiming a granted domain while pointing the URL at a LAN address must be
    // refused — the whole reason the allowlist exists.
    reg.mintPairingCode("o", "C"); reg.redeem("C", link());
    const evil = reg.submit("o", { id: "x", podId: "p", url: "http://192.168.1.1/admin", domain: "" });
    expect(evil.status).toBe("refused");
    expect(sent).toHaveLength(0);
  });

  it("serves any PUBLIC host — authorisation is the relay's job now, not the gateway's", () => {
    // The gateway dropped the per-owner allowlist; the owner's machine decides
    // (clean-by-default). The gateway keeps only the SSRF guard, tested above.
    reg.mintPairingCode("o", "C"); reg.redeem("C", link());
    expect(reg.submit("o", { id: "x", podId: "p", url: "https://some-site.com/x", domain: "" }).status).toBe("dispatched");
    expect(JSON.parse(sent[0]!)).toMatchObject({ source: { podId: "p" } });
  });

  it("keeps detailed source/path metadata on the owner-bound frame", () => {
    reg.mintPairingCode("o", "C"); reg.redeem("C", link());
    reg.submit("o", { id: "private-detail", podId: "pod-private", url: "https://example.com/private/report", domain: "example.com" });
    const frame = JSON.parse(sent[0]!);
    expect(frame).toMatchObject({ url: "https://example.com/private/report", source: { podId: "pod-private" } });
    const telemetry = JSON.stringify(reg.metrics());
    expect(telemetry).not.toContain("/private/report");
    expect(telemetry).not.toContain('"source"');
  });

  it("lets only the owning relay complete a request, not another owner's", () => {
    reg.mintPairingCode("a", "CA"); reg.redeem("CA", link());
    let got: unknown;
    reg.await("a", "pod-a", "shared-id", (r) => (got = r));
    // Owner B tries to answer A's request id — must be rejected.
    expect(reg.complete("b", { id: "shared-id", status: 200, body: "poison" })).toBe(false);
    expect(got).toBeUndefined();
    expect(reg.complete("a", { id: "shared-id", status: 200, body: "real" })).toBe(true);
  });

  it("does not tear down a NEW relay when the OLD one's close fires late", () => {
    const a = link();
    reg.mintPairingCode("o", "C1"); reg.redeem("C1", a);
    const b = link();
    reg.mintPairingCode("o", "C2"); reg.redeem("C2", b); // replaces a
    // a's socket now closes, a tick later — must NOT remove b.
    reg.disconnect("o", a);
    expect(reg.state("o").connected).toBe(true);
  });

  it("expires an awaiter whose relay never answered, instead of leaking it", () => {
    let got: { error?: string } | undefined;
    reg.await("o", "p", "lost", (r) => (got = r), 1000);
    now += 1001;
    reg.sweep();
    expect(got?.error).toMatch(/timed out/);
  });

  it("sweeps a minted-but-never-redeemed pairing code", () => {
    reg.mintPairingCode("o", "STALE");
    now += 11 * 60_000;
    reg.sweep();
    // A code the sweep removed can no longer be redeemed.
    expect(reg.redeem("STALE", link())).toBeNull();
  });

  it("does not charge the budget for a request a closing socket dropped", () => {
    // send() returns false → the request is not counted as dispatched, so the caller
    // is not told it happened and the rate budget is untouched.
    const deadLink = { send: () => false, close: () => {} };
    reg.mintPairingCode("o", "C"); reg.redeem("C", deadLink);
    const out = reg.submit("o", { id: "x", podId: "p", url: "https://reddit.com/x", domain: "reddit.com" });
    expect(out.status).toBe("queued"); // fell through to the queue, not "dispatched"
  });
});
