import { describe, it, expect, beforeEach } from "vitest";
import { PodControlHub, type PodLink, type FetchMemorySink } from "../src/pod-control-hub.js";

/** A fake link whose inbound handler we can drive, and whose sends we can read. */
class FakeLink implements PodLink {
  sent: string[] = [];
  closed = false;
  private msg?: (raw: string) => void;
  private closeCb?: () => void;
  send(json: string) { this.sent.push(json); }
  close() { this.closed = true; this.closeCb?.(); }
  onMessage(h: (raw: string) => void) { this.msg = h; }
  onClose(h: () => void) { this.closeCb = h; }
  deliver(raw: string) { this.msg?.(raw); }
}

let recorded: { domain: string; rung: string; outcome: string }[];
let planDomains: Record<string, unknown>;
let memory: FetchMemorySink;
let links: Map<string, FakeLink>;
let logs: string[];

const mkHub = (over: Partial<Parameters<typeof PodControlHub.prototype.constructor>[0]> = {}) =>
  new PodControlHub({
    connect: async (podId) => {
      const l = new FakeLink();
      links.set(podId, l);
      return l;
    },
    memory,
    log: (e) => logs.push(e),
    ...over,
  });

beforeEach(() => {
  recorded = [];
  planDomains = { "reddit.com": { good: ["relay"], bad: [] } };
  links = new Map();
  logs = [];
  memory = {
    record: async (_podId, domain, rung, outcome) => { recorded.push({ domain, rung, outcome }); },
    fleetPlan: async () => ({ domains: planDomains }),
  };
});

describe("connection lifecycle", () => {
  it("opens a socket per running pod and pushes the plan on connect", async () => {
    const hub = mkHub();
    await hub.ensure(["pod-a", "pod-b"]);
    expect(hub.connectedPods().sort()).toEqual(["pod-a", "pod-b"]);
    // Each freshly-connected pod gets the plan immediately, not on the next tick.
    expect(JSON.parse(links.get("pod-a")!.sent[0]).type).toBe("fetch-plan");
  });

  it("closes sockets for pods that stopped running, keeps the rest ALIVE", async () => {
    const hub = mkHub();
    await hub.ensure(["pod-a", "pod-b"]);
    const a = links.get("pod-a")!;
    await hub.ensure(["pod-a"]); // pod-b gone
    expect(links.get("pod-b")!.closed).toBe(true);
    // pod-a must NOT be torn down and rebuilt — a healthy socket survives a sweep.
    expect(a.closed).toBe(false);
    expect(hub.connectedPods()).toEqual(["pod-a"]);
  });

  it("does not open a duplicate socket to a pod already connected", async () => {
    const hub = mkHub();
    await hub.ensure(["pod-a"]);
    const first = links.get("pod-a")!;
    await hub.ensure(["pod-a", "pod-a"]);
    expect(links.get("pod-a")).toBe(first); // same link, not replaced
  });

  it("drops a pod whose connect throws, freeing the slot to retry (no cooldown here)", async () => {
    let fail = true;
    // cooldownMs 0: this test is about the slot being freed on failure, not the
    // backoff — the backoff has its own test below.
    const hub = new PodControlHub({
      connect: async (podId) => {
        if (fail) throw new Error("unreachable");
        const l = new FakeLink();
        links.set(podId, l);
        return l;
      },
      memory,
      log: (e) => logs.push(e),
    }, 0);
    await hub.ensure(["pod-a"]);
    expect(hub.connectedPods()).toEqual([]);
    expect(logs).toContain("control_connect_failed");
    fail = false;
    await hub.ensure(["pod-a"]); // the slot was freed, so it retries
    expect(hub.connectedPods()).toEqual(["pod-a"]);
  });

  it("backs off a TRANSIENT connect failure, then retries after the short cooldown", async () => {
    // A refused/timed-out dial (the pod is booting) might succeed next time, so the
    // short cooldown applies and a retry is expected once it elapses.
    let now = 1_000_000;
    let fail = true;
    const hub = new PodControlHub(
      {
        connect: async (podId) => {
          if (fail) throw new Error("connect ECONNREFUSED");
          const l = new FakeLink(); links.set(podId, l); return l;
        },
        memory,
        log: (e) => logs.push(e),
      },
      60_000,
      () => now,
    );
    await hub.ensure(["booting-pod"]);
    logs.length = 0;
    await hub.ensure(["booting-pod"]); // still in cooldown → not re-dialled
    expect(logs).not.toContain("control_connect_failed");
    now += 61_000; // short cooldown elapsed
    fail = false;
    await hub.ensure(["booting-pod"]);
    expect(hub.connectedPods()).toEqual(["booting-pod"]);
  });

  it("backs off a CAPABILITY MISS far harder — an old-image pod is not re-poked every few minutes", async () => {
    // A pod that answers but has no /control route (old image) fails the handshake and
    // its terminal handler got poked for nothing. Re-probing it soon would churn that
    // terminal (the makore RC flapping), so the long stale-image cooldown applies.
    let now = 1_000_000;
    let dials = 0;
    const hub = new PodControlHub(
      {
        connect: async () => { dials++; throw new Error("not a control socket (first frame: windows)"); },
        memory,
        log: (e) => logs.push(e),
      },
      60_000, // short cooldown (transient)
      () => now,
      8,
      3_600_000, // stale-image cooldown = 1h
    );
    await hub.ensure(["old-pod"]);
    expect(dials).toBe(1);
    now += 61_000; // PAST the short cooldown, but not the stale one
    await hub.ensure(["old-pod"]);
    expect(dials).toBe(1); // NOT re-dialled — the capability miss earned the long backoff
    now += 3_600_000; // past the stale cooldown
    await hub.ensure(["old-pod"]);
    expect(dials).toBe(2); // eventually re-probed, so an updated pod is picked up
  });

  it("resetControlCooldown lets a restarted pod re-dial before the stale backoff elapses", async () => {
    let now = 1_000_000;
    let dials = 0;
    let capable = false;
    const hub = new PodControlHub(
      {
        connect: async (podId) => {
          dials++;
          if (!capable) throw new Error("not a control socket (first frame: links)");
          const l = new FakeLink(); links.set(podId, l); return l;
        },
        memory,
        log: (e) => logs.push(e),
      },
      60_000,
      () => now,
      8,
      3_600_000, // 1h stale cooldown
    );
    await hub.ensure(["pod"]);
    expect(dials).toBe(1); // failed → 1h cooldown
    now += 61_000;
    await hub.ensure(["pod"]);
    expect(dials).toBe(1); // still cooling down
    // The pod restarts onto a control-capable image; its terminal dropped upstream.
    capable = true;
    hub.resetControlCooldown("pod");
    await hub.ensure(["pod"]);
    expect(dials).toBe(2); // re-dialled immediately, not after an hour
    expect(hub.connectedPods()).toEqual(["pod"]);
  });

  it("bounds how many pods it dials at once", async () => {
    // Unbounded fan-out means a gateway restart dials EVERY running pod
    // simultaneously, each with a handshake timeout, on one vCPU.
    let inFlight = 0;
    let peak = 0;
    const hub = new PodControlHub(
      {
        connect: async (podId) => {
          inFlight++; peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
          const l = new FakeLink(); links.set(podId, l); return l;
        },
        memory,
        log: (e) => logs.push(e),
      },
      10 * 60_000,
      () => Date.now(),
      3, // cap
    );
    await hub.ensure(Array.from({ length: 12 }, (_, i) => `pod-${i}`));
    expect(peak).toBeLessThanOrEqual(3);
    expect(hub.connectedPods()).toHaveLength(12); // all still get connected
  });

  it("does not TypeError when a pod departs mid-dial (null placeholder)", async () => {
    // The dial is in flight (placeholder link is null) when the pod leaves the running
    // set — closing a null link must not throw and wedge the whole sweep.
    let release: (() => void) | null = null;
    const slow = new PodControlHub({
      connect: (podId) =>
        new Promise((resolve) => {
          release = () => resolve((() => { const l = new FakeLink(); links.set(podId, l); return l; })());
        }),
      memory,
      log: (e) => logs.push(e),
    });
    const dialing = slow.ensure(["pod-x"]); // hangs on connect
    await slow.ensure([]); // pod-x departs while still dialing → must not throw
    release?.();
    await dialing;
    // The orphaned socket is closed, not adopted.
    expect(slow.connectedPods()).toEqual([]);
  });

  it("forgets a pod when its socket closes on its own", async () => {
    const hub = mkHub();
    await hub.ensure(["pod-a"]);
    links.get("pod-a")!.close();
    expect(hub.connectedPods()).toEqual([]);
  });
});

describe("routing a pod's messages", () => {
  it("records every drained outcome into fetch memory", async () => {
    const hub = mkHub();
    await hub.ensure(["pod-a"]);
    links.get("pod-a")!.deliver(JSON.stringify({
      type: "fetch-outcomes",
      reports: [
        { domain: "reddit.com", rung: "direct", outcome: "blocked" },
        { domain: "reddit.com", rung: "relay", outcome: "ok" },
      ],
    }));
    await Promise.resolve(); await Promise.resolve();
    expect(recorded).toHaveLength(2);
    expect(recorded[1]).toEqual({ domain: "reddit.com", rung: "relay", outcome: "ok" });
  });

  it("skips a malformed row without losing the rest of the batch", async () => {
    const hub = mkHub();
    await hub.ensure(["pod-a"]);
    links.get("pod-a")!.deliver(JSON.stringify({
      type: "fetch-outcomes",
      reports: [{ nope: 1 }, { domain: "good.com", rung: "direct", outcome: "ok" }],
    }));
    await Promise.resolve(); await Promise.resolve();
    expect(recorded).toEqual([{ domain: "good.com", rung: "direct", outcome: "ok" }]);
  });

  it("routes a relay-fetch to the router, or logs when there is none yet", async () => {
    const routed: unknown[] = [];
    const hub = mkHub({ onRelayFetch: (podId, req) => routed.push({ podId, ...req }) });
    await hub.ensure(["pod-a"]);
    links.get("pod-a")!.deliver(JSON.stringify({ type: "relay-fetch", id: "x1", url: "https://reddit.com/r", domain: "reddit.com", source: { podId: "forged-sibling" } }));
    expect(routed).toEqual([{ podId: "pod-a", id: "x1", url: "https://reddit.com/r", domain: "reddit.com" }]);
    expect(recorded, "relay detail must not enter persisted fetch memory").toEqual([]);
    expect(logs.join(" ")).not.toContain("https://reddit.com/r");

    const hub2 = mkHub(); // no router
    await hub2.ensure(["pod-b"]);
    links.get("pod-b")!.deliver(JSON.stringify({ type: "relay-fetch", id: "x2", url: "u", domain: "d" }));
    expect(logs).toContain("relay_fetch_no_router");
  });

  it("ignores junk, unknown types, and a pong", async () => {
    const hub = mkHub();
    await hub.ensure(["pod-a"]);
    const a = links.get("pod-a")!;
    a.deliver("not json");
    a.deliver(JSON.stringify({ type: "who-knows" }));
    a.deliver(JSON.stringify({ type: "pong" }));
    await Promise.resolve();
    expect(recorded).toEqual([]);
    expect(logs).toContain("control_bad_json");
    expect(logs).toContain("control_unknown_type");
  });
});

describe("pushing downstream", () => {
  it("sends a relay result only to a connected pod", async () => {
    const hub = mkHub();
    await hub.ensure(["pod-a"]);
    expect(hub.sendRelayResult("pod-a", { id: "x", status: 200, body: "hi" })).toBe(true);
    expect(hub.sendRelayResult("pod-missing", { id: "x", status: 200, body: "hi" })).toBe(false);
    expect(JSON.parse(links.get("pod-a")!.sent.at(-1)!).type).toBe("relay-result");
  });

  it("broadcasts the plan to all connected pods on a tick", async () => {
    const hub = mkHub();
    await hub.ensure(["pod-a", "pod-b"]);
    links.get("pod-a")!.sent.length = 0;
    links.get("pod-b")!.sent.length = 0;
    await hub.pushPlan();
    expect(JSON.parse(links.get("pod-a")!.sent[0]).type).toBe("fetch-plan");
    expect(JSON.parse(links.get("pod-b")!.sent[0]).domains["reddit.com"]).toBeTruthy();
  });
});

describe("relay state is SYNCED to a pod that joins late", () => {
  it("pushes relay-state when the control link opens (not only on broadcast)", async () => {
    // The live bug (moderate-peacock-59a7, 2026-08-04): relay state was only ever
    // broadcast on connect/disconnect, so a pod whose link opened AFTER its owner's
    // relay never learned it existed — `podbay fetch` offered a pairing code for a relay
    // that was up and serving.
    const hub = mkHub({
      relayStateFor: async () => ({ connected: true, domains: ["reddit.com"] }),
    });
    await hub.ensure(["pod1"]);
    const sent = links.get("pod1")!.sent.map((s) => JSON.parse(s) as { type: string; connected?: boolean });
    const state = sent.find((m) => m.type === "relay-state");
    expect(state, "a freshly-opened control link must be told the relay state").toBeTruthy();
    expect(state!.connected).toBe(true);
  });

  it("says nothing when the gateway has no relay state to report", async () => {
    const hub = mkHub({ relayStateFor: async () => null });
    await hub.ensure(["pod1"]);
    const sent = links.get("pod1")!.sent.map((s) => JSON.parse(s) as { type: string });
    expect(sent.find((m) => m.type === "relay-state")).toBeUndefined();
  });
});
