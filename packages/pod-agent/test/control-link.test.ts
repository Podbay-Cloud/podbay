import { describe, it, expect, beforeEach } from "vitest";
import { handleControlMessage, takeOutcomes, type ControlDeps } from "../src/control-link.js";

let plan: string | null;
let relayState: string | null;
let sent: unknown[];
let delivered: { id: string; ok: boolean }[];
let logs: string[];
let deps: ControlDeps;

beforeEach(() => {
  plan = null;
  relayState = null;
  sent = [];
  delivered = [];
  logs = [];
  deps = {
    writePlan: (j) => (plan = j),
    writeRelayState: (j) => (relayState = j),
    deliverRelayResult: (id) => {
      const ok = id === "known";
      delivered.push({ id, ok });
      return ok;
    },
    send: (m) => sent.push(m),
    log: (e) => logs.push(e),
  };
});

/**
 * This socket carries fetch memory, relay state and relay results. A bad frame from
 * any of them must not take down the others — so "never throws" is the property under
 * test as much as the happy paths.
 */
describe("handling a control frame", () => {
  it("caches the fleet plan whole", () => {
    handleControlMessage(JSON.stringify({ type: "fetch-plan", domains: { "a.com": { good: ["direct"] } } }), deps);
    expect(JSON.parse(plan!).domains["a.com"].good).toEqual(["direct"]);
  });

  it("writes an EMPTY plan rather than merging into a stale one", () => {
    // A partial plan that looks complete is worse than an old one, because nothing
    // downstream can tell the difference.
    handleControlMessage(JSON.stringify({ type: "fetch-plan", domains: { "a.com": {} } }), deps);
    handleControlMessage(JSON.stringify({ type: "fetch-plan" }), deps);
    expect(JSON.parse(plan!).domains).toEqual({});
  });

  it("records relay state so an agent can report pending before it tries", () => {
    handleControlMessage(JSON.stringify({ type: "relay-state", connected: true, domains: ["reddit.com"] }), deps);
    const s = JSON.parse(relayState!);
    expect(s.connected).toBe(true);
    expect(s.domains).toEqual(["reddit.com"]);
  });

  it("discards a relay result nobody asked for", () => {
    // A relay must not be able to inject content for a request that was never made.
    handleControlMessage(JSON.stringify({ type: "relay-result", id: "unknown", status: 200, body: "x" }), deps);
    expect(delivered).toEqual([{ id: "unknown", ok: false }]);
    expect(logs).toContain("control_unmatched_relay_result");
  });

  it("answers a ping, so a dead socket is detectable", () => {
    handleControlMessage(JSON.stringify({ type: "ping" }), deps);
    expect(sent).toEqual([{ type: "pong" }]);
  });

  it("survives garbage, an unknown type, and a throwing handler", () => {
    handleControlMessage("not json at all", deps);
    handleControlMessage(JSON.stringify({ nope: 1 }), deps);
    handleControlMessage(JSON.stringify({ type: "who-knows" }), deps);
    handleControlMessage(JSON.stringify({ type: "fetch-plan", domains: {} }), {
      ...deps,
      writePlan: () => {
        throw new Error("disk full");
      },
    });
    expect(logs).toEqual([
      "control_bad_json",
      "control_bad_shape",
      "control_unknown_type",
      "control_handler_failed",
    ]);
  });
});

describe("taking buffered outcomes", () => {
  it("parses lines and clears only when there was something to take", () => {
    let cleared = 0;
    const rows = takeOutcomes(
      () => '{"domain":"a.com","rung":"direct","outcome":"ok"}\n{"bad json\n',
      () => cleared++,
    );
    expect(rows).toHaveLength(1);
    expect(cleared).toBe(1);

    expect(takeOutcomes(() => "", () => cleared++)).toEqual([]);
    expect(cleared, "an empty buffer must not be 'cleared'").toBe(1);
  });

  it("returns nothing rather than throwing when the buffer cannot be read", () => {
    expect(
      takeOutcomes(
        () => {
          throw new Error("ENOENT");
        },
        () => {},
      ),
    ).toEqual([]);
  });

  it("keeps the NEWEST when the buffer is over the cap", () => {
    const many = Array.from({ length: 20 }, (_, i) => JSON.stringify({ n: i })).join("\n");
    const rows = takeOutcomes(() => many, () => {}, 5) as { n: number }[];
    expect(rows.map((r) => r.n)).toEqual([15, 16, 17, 18, 19]);
  });
});
