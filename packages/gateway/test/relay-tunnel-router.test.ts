import { describe, it, expect, vi } from "vitest";
import { TunnelRouter } from "../src/relay-tunnel-router.js";

function harness(
  opts: {
    relay?: boolean;
    policy?: Record<string, number>;
    owner?: string | null;
    canaryTarget?: { host: string; port: number };
  } = {},
) {
  const toRelay: Record<string, unknown>[] = [];
  const toPod: { podId: string; msg: Record<string, unknown> }[] = [];
  let clock = 1_000_000;
  const link = { send: (p: string) => (toRelay.push(JSON.parse(p)), true) };
  const router = new TunnelRouter({
    ownerOf: async () => (opts.owner === undefined ? "owner1" : opts.owner),
    relayLink: () => (opts.relay === false ? null : link),
    toPod: (podId, msg) => (toPod.push({ podId, msg }), true),
    now: () => clock,
    policy: opts.policy,
    canaryTarget: opts.canaryTarget,
  });
  return {
    router, toRelay, toPod,
    tick: (ms: number) => (clock += ms),
    lastToPod: () => toPod[toPod.length - 1]!.msg,
    gwId: () => (toRelay.find((m) => m.type === "tunnel-open")?.id as string) ?? "",
    /** The id of the most recent tunnel-open — a canary's, when one is in flight. */
    lastOpenId: () => [...toRelay].reverse().find((m) => m.type === "tunnel-open")!.id as string,
  };
}

describe("TunnelRouter — routing", () => {
  it("opens a stream to the owner's relay under a gateway-minted id", async () => {
    const h = harness();
    await h.router.open("pod1", "s1", "example.com", 443);
    expect(h.toRelay[0]).toMatchObject({ type: "tunnel-open", host: "example.com", port: 443, source: { podId: "pod1" } });
    expect(h.toRelay[0]!.id).not.toBe("s1"); // never the pod's own id
  });

  it("includes the gateway-resolved pod display name in the tunnel-open source", async () => {
    const toRelay: Record<string, unknown>[] = [];
    const link = { send: (p: string) => (toRelay.push(JSON.parse(p)), true) };
    const router = new TunnelRouter({
      ownerOf: async () => "owner1",
      podName: async () => "My Crawler",
      relayLink: () => link,
      toPod: () => true,
    });
    await router.open("pod1", "s1", "example.com", 443);
    expect(toRelay[0]).toMatchObject({ type: "tunnel-open", source: { podId: "pod1", podName: "My Crawler" } });
  });

  it("routes ready/data/close back to the pod under the POD's id", async () => {
    const h = harness();
    await h.router.open("pod1", "s1", "example.com", 443);
    const gw = h.gwId();

    h.router.fromRelay("owner1", { type: "tunnel-ready", id: gw });
    expect(h.lastToPod()).toMatchObject({ type: "tunnel-ready", id: "s1" });

    h.router.fromRelay("owner1", { type: "tunnel-data", id: gw, b64: Buffer.from("hi").toString("base64") });
    expect(h.lastToPod()).toMatchObject({ type: "tunnel-data", id: "s1" });

    h.router.fromRelay("owner1", { type: "tunnel-close", id: gw });
    expect(h.lastToPod()).toMatchObject({ type: "tunnel-close", id: "s1" });
  });

  it("forwards pod bytes up to the relay", async () => {
    const h = harness();
    await h.router.open("pod1", "s1", "example.com", 443);
    const b64 = Buffer.from("GET /").toString("base64");
    expect(h.router.fromPod("pod1", "s1", { kind: "data", b64 })).toBe(true);
    expect(h.toRelay.find((m) => m.type === "tunnel-data")).toMatchObject({ id: h.gwId(), b64 });
  });

  it("REFUSES a frame from another owner (no cross-owner hijack)", async () => {
    const h = harness();
    await h.router.open("pod1", "s1", "example.com", 443);
    expect(h.router.fromRelay("someone-else", { type: "tunnel-ready", id: h.gwId() })).toBe(false);
  });

  it("drops a frame for a stream that was never opened", () => {
    const h = harness();
    expect(h.router.fromRelay("owner1", { type: "tunnel-data", id: "nope", b64: "" })).toBe(false);
    expect(h.router.fromPod("pod1", "nope", { kind: "close" })).toBe(false);
  });
});

describe("TunnelRouter — guards", () => {
  it("refuses the owner's LAN even if the pod asks (platform-side SSRF)", async () => {
    const h = harness();
    for (const host of ["127.0.0.1", "192.168.0.5", "169.254.169.254", "localhost"]) {
      await h.router.open("pod1", `s-${host}`, host, 80);
      expect(h.lastToPod()).toMatchObject({ type: "tunnel-refused" });
    }
    expect(h.toRelay).toHaveLength(0); // nothing ever reached the relay
  });

  it("fails closed when no relay is connected", async () => {
    const h = harness({ relay: false });
    await h.router.open("pod1", "s1", "example.com", 443);
    expect(h.lastToPod()).toMatchObject({ type: "tunnel-refused", reason: "no relay connected" });
  });

  it("refuses when the pod has no owner", async () => {
    const h = harness({ owner: null });
    await h.router.open("pod1", "s1", "example.com", 443);
    expect(h.lastToPod()).toMatchObject({ type: "tunnel-refused", reason: "no owner for pod" });
  });

  it("HOLDS a stream over the per-pod cap instead of refusing, then admits it when a slot frees", async () => {
    const h = harness({ policy: { maxPerPod: 2 } });
    await h.router.open("pod1", "a", "example.com", 443);
    await h.router.open("pod1", "b", "example.com", 443);
    await h.router.open("pod1", "c", "example.com", 443); // over cap → held, NOT refused
    expect(h.toRelay.filter((m) => m.type === "tunnel-open")).toHaveLength(2);
    expect(h.toPod).toHaveLength(0); // no refusal reached the pod

    // Close one open stream → the held "c" is admitted (its tunnel-open now reaches the relay).
    h.router.fromPod("pod1", "a", { kind: "close" });
    expect(h.toRelay.filter((m) => m.type === "tunnel-open")).toHaveLength(3);
    expect(h.toPod.some((x) => x.msg.type === "tunnel-refused")).toBe(false);
  });

  it("refuses a held stream if no slot frees within the hold window", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ policy: { maxPerPod: 1 } });
      await h.router.open("pod1", "a", "example.com", 443);
      await h.router.open("pod1", "b", "example.com", 443); // held
      expect(h.toPod).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(6_000); // hold window lapses
      expect(h.lastToPod()).toMatchObject({ type: "tunnel-refused", id: "b", reason: "too many open connections for this pod" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a held stream frees an OWNER slot for a sibling pod, not just its own", async () => {
    const h = harness({ policy: { maxPerOwner: 1 } });
    await h.router.open("pod1", "a", "example.com", 443);
    await h.router.open("pod2", "b", "example.com", 443); // over owner cap → held
    expect(h.toRelay.filter((m) => m.type === "tunnel-open")).toHaveLength(1);
    h.router.fromPod("pod1", "a", { kind: "close" }); // frees the single owner slot
    expect(h.toRelay.filter((m) => m.type === "tunnel-open")).toHaveLength(2);
  });

  it("refuses immediately once the hold queue itself is full (a pod cannot exhaust the relay)", async () => {
    // cap 1 open + at most 1 queued for the pod → the 3rd is a hard refuse, not an unbounded hold.
    const h = harness({ policy: { maxPerPod: 1 } });
    await h.router.open("pod1", "a", "example.com", 443); // open
    await h.router.open("pod1", "b", "example.com", 443); // held (queue depth 1)
    await h.router.open("pod1", "c", "example.com", 443); // queue full → refused now
    expect(h.lastToPod()).toMatchObject({ type: "tunnel-refused", id: "c", reason: "too many open connections for this pod" });
  });

  it("drops held streams when the pod's link goes away, and fails them closed when the relay does", async () => {
    const h1 = harness({ policy: { maxPerPod: 1 } });
    await h1.router.open("pod1", "a", "example.com", 443);
    await h1.router.open("pod1", "b", "example.com", 443); // held
    h1.router.dropPod("pod1"); // pod gone → held "b" silently dropped, nothing sent to it
    expect(h1.toPod.some((x) => x.msg.id === "b")).toBe(false);

    const h2 = harness({ policy: { maxPerPod: 1 } });
    await h2.router.open("pod1", "a", "example.com", 443);
    await h2.router.open("pod1", "b", "example.com", 443); // held
    h2.router.dropOwner("owner1"); // relay gone → held "b" fails closed at the pod
    expect(h2.toPod.some((x) => x.msg.type === "tunnel-close" && x.msg.id === "a")).toBe(true);
    expect(h2.toPod.some((x) => x.msg.type === "tunnel-refused" && x.msg.id === "b")).toBe(true);
  });

  it("caps new connections per domain per minute, and the window slides", async () => {
    const h = harness({ policy: { ratePerDomainPerMin: 2 } });
    await h.router.open("pod1", "a", "example.com", 443);
    await h.router.open("pod1", "b", "example.com", 443);
    await h.router.open("pod1", "c", "example.com", 443);
    expect(h.lastToPod()).toMatchObject({ type: "tunnel-refused", reason: "rate limit for this site" });

    // A successful open sends nothing to the pod (it waits for the relay's ready), so
    // assert on what actually changes: another tunnel-open reaching the relay.
    expect(h.toRelay.filter((m) => m.type === "tunnel-open")).toHaveLength(2);
    h.tick(61_000); // the minute passes
    await h.router.open("pod1", "d", "example.com", 443);
    expect(h.toRelay.filter((m) => m.type === "tunnel-open")).toHaveLength(3);
  });

  it("a refusal is not counted against the rate budget", async () => {
    const h = harness({ policy: { ratePerDomainPerMin: 2 } });
    await h.router.open("pod1", "x", "127.0.0.1", 80); // refused (SSRF), must not consume budget
    await h.router.open("pod1", "a", "example.com", 443);
    await h.router.open("pod1", "b", "example.com", 443);
    expect(h.toRelay.filter((m) => m.type === "tunnel-open")).toHaveLength(2);
  });
});

describe("TunnelRouter — teardown + metering", () => {
  it("a relay going away closes its streams at the pod (fail closed)", async () => {
    const h = harness();
    await h.router.open("pod1", "s1", "example.com", 443);
    h.router.dropOwner("owner1");
    expect(h.lastToPod()).toMatchObject({ type: "tunnel-close", id: "s1" });
  });

  it("a pod going away closes its streams at the relay", async () => {
    const h = harness();
    await h.router.open("pod1", "s1", "example.com", 443);
    h.router.dropPod("pod1");
    expect(h.toRelay.some((m) => m.type === "tunnel-close")).toBe(true);
  });

  it("meters connections and bytes per DOMAIN only", async () => {
    const h = harness();
    await h.router.open("pod1", "s1", "example.com", 443);
    const gw = h.gwId();
    h.router.fromPod("pod1", "s1", { kind: "data", b64: Buffer.alloc(300).toString("base64") });
    h.router.fromRelay("owner1", { type: "tunnel-data", id: gw, b64: Buffer.alloc(900).toString("base64") });

    const snap = h.router.usageSnapshot();
    expect(snap.open).toBe(1);
    const d = snap.domains.find((x) => x.domain === "example.com")!;
    expect(d.connections).toBe(1);
    expect(d.bytesUp).toBeGreaterThanOrEqual(300);
    expect(d.bytesDown).toBeGreaterThanOrEqual(900);
    expect(Object.keys(d)).toEqual(["domain", "connections", "bytesUp", "bytesDown"]); // no URL/path
  });

  it("does not double-count bytes when the stream closes", async () => {
    const h = harness();
    await h.router.open("pod1", "s1", "example.com", 443);
    h.router.fromPod("pod1", "s1", { kind: "data", b64: Buffer.alloc(300).toString("base64") });
    const before = h.router.usageSnapshot().domains[0]!.bytesUp;
    h.router.fromPod("pod1", "s1", { kind: "close" });
    expect(h.router.usageSnapshot().domains[0]!.bytesUp).toBe(before);
  });
});

describe("TunnelRouter — health", () => {
  const TARGET = { host: "podbay.cloud", port: 443 };

  it("a canary dials podbay's OWN host and reports ok when the relay connects", async () => {
    const h = harness({ canaryTarget: TARGET });
    const probe = h.router.canary("owner1");
    const open = h.toRelay.find((m) => m.type === "tunnel-open")!;
    expect(open).toMatchObject({ host: "podbay.cloud", port: 443, source: { system: "health-check" } });
    h.router.fromRelay("owner1", { type: "tunnel-ready", id: open.id as string });
    expect(await probe).toMatchObject({ state: "ok", probe: true });
    // …and closes immediately, so proving it works costs one handshake, not a session.
    expect(h.toRelay.some((m) => m.type === "tunnel-close" && m.id === open.id)).toBe(true);
  });

  it("a canary is the GATEWAY's stream — it never reaches a pod", async () => {
    const h = harness({ canaryTarget: TARGET });
    const probe = h.router.canary("owner1");
    h.router.fromRelay("owner1", { type: "tunnel-ready", id: h.lastOpenId() });
    await probe;
    expect(h.toPod).toHaveLength(0);
  });

  it("reports failed when the relay refuses, with the reason", async () => {
    const h = harness({ canaryTarget: TARGET });
    const probe = h.router.canary("owner1");
    h.router.fromRelay("owner1", { type: "tunnel-refused", id: h.lastOpenId(), reason: "dns failed" });
    expect(await probe).toMatchObject({ state: "failed", reason: "dns failed" });
    expect(h.router.healthOf("owner1")).toMatchObject({ state: "failed" });
  });

  it("reports failed — not a hang — when the relay never answers", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ canaryTarget: TARGET });
      const probe = h.router.canary("owner1");
      await vi.advanceTimersByTimeAsync(11_000);
      expect(await probe).toMatchObject({ state: "failed", reason: "timed out" });
      // The stalled stream is closed at the relay rather than leaked.
      expect(h.toRelay.some((m) => m.type === "tunnel-close")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says failed with no relay, and unknown with no configured target", async () => {
    expect(await harness({ canaryTarget: TARGET, relay: false }).router.canary("owner1")).toMatchObject({
      state: "failed",
      reason: "no relay connected",
    });
    expect(await harness().router.canary("owner1")).toMatchObject({ state: "unknown" });
  });

  it("records ok PASSIVELY from real traffic, and never failure from it", async () => {
    const h = harness();
    await h.router.open("pod1", "s1", "example.com", 443);
    h.router.fromRelay("owner1", { type: "tunnel-ready", id: h.gwId() });
    expect(h.router.healthOf("owner1")).toMatchObject({ state: "ok", probe: false });

    // One unreachable target is not a broken tunnel — health must NOT flip to failed.
    await h.router.open("pod1", "s2", "dead.example", 443);
    const gw2 = (h.toRelay.filter((m) => m.type === "tunnel-open")[1]!.id) as string;
    h.router.fromRelay("owner1", { type: "tunnel-refused", id: gw2, reason: "ECONNREFUSED" });
    expect(h.router.healthOf("owner1")).toMatchObject({ state: "ok" });
  });

  it("a pending canary fails closed when the relay disconnects", async () => {
    const h = harness({ canaryTarget: TARGET });
    const probe = h.router.canary("owner1");
    h.router.dropOwner("owner1");
    expect(await probe).toMatchObject({ state: "failed", reason: "relay disconnected" });
  });
});

describe("TunnelRouter — per-owner and per-pod usage", () => {
  it("rolls up per owner cumulatively, and per POD live-only", async () => {
    const h = harness();
    await h.router.open("pod1", "s1", "example.com", 443);
    await h.router.open("pod2", "s1", "other.example", 443);
    h.router.fromPod("pod1", "s1", { kind: "data", b64: Buffer.from("hello").toString("base64") });

    const snap = h.router.usageSnapshot();
    expect(snap.owners).toHaveLength(1);
    expect(snap.owners[0]).toMatchObject({ ownerId: "owner1", open: 2, connections: 2 });
    expect(snap.owners[0]!.bytesUp).toBeGreaterThan(0);
    expect(snap.pods.map((p) => p.podId).sort()).toEqual(["pod1", "pod2"]);
    expect(snap.pods.find((p) => p.podId === "pod1")!.domains).toEqual(["example.com"]);

    // Closing the stream drops the pod from view (never accumulated) while the owner's
    // cumulative counters stay — that asymmetry is the metering rule, not an oversight.
    h.router.fromPod("pod1", "s1", { kind: "close" });
    h.router.fromPod("pod2", "s1", { kind: "close" });
    const after = h.router.usageSnapshot();
    expect(after.pods).toEqual([]);
    expect(after.owners[0]).toMatchObject({ connections: 2, open: 0 });
  });

  it("lists an owner whose relay was probed but has carried nothing", async () => {
    const h = harness({ canaryTarget: { host: "podbay.cloud", port: 443 } });
    const probe = h.router.canary("owner1");
    h.router.fromRelay("owner1", { type: "tunnel-ready", id: h.lastOpenId() });
    await probe;
    expect(h.router.usageSnapshot().owners[0]).toMatchObject({
      ownerId: "owner1",
      connections: 0,
      health: { state: "ok" },
    });
  });
});
