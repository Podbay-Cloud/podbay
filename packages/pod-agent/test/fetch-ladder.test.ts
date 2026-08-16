import { describe, it, expect } from "vitest";
import { climb, adviseFrom, DEFAULT_ORDER } from "../src/fetch-ladder.js";

const ok = (text = "Real content. ".repeat(40)) => async () => ({ status: 200, body: `<p>${text}</p>` });
const blocked = () => async () => ({ status: 403, body: "You've been blocked by network security" });
const shell = () => async () => ({ status: 200, body: "<html><body><div id=root></div></body></html>" });
const throws = () => async () => { throw new Error("connect ECONNREFUSED"); };

/**
 * The ladder's job is to be RIGHT about what happened, not just to return bytes. So
 * these test the decisions: what order, what gets skipped, what is reported back, and
 * what the caller is told when nothing worked.
 */
describe("climbing the ladder", () => {
  it("stops at the first rung that returns verified content", async () => {
    const r = await climb({ url: "https://x.com", fetchers: { direct: ok(), browser: ok() } });
    expect(r.ok).toBe(true);
    expect(r.rung).toBe("direct");
    // It must not keep climbing after success — a browser launch we did not need is
    // seconds wasted on every fetch.
    expect(r.attempts).toHaveLength(1);
  });

  it("escalates past a shell to the browser, which is the whole point of 1b", async () => {
    const r = await climb({ url: "https://x.com", fetchers: { direct: shell(), browser: ok() } });
    expect(r.ok).toBe(true);
    expect(r.rung).toBe("browser");
    expect(r.attempts[0]!.verdict.outcome).toBe("empty");
  });

  it("tries a KNOWN-GOOD rung first — the saving shared memory actually buys", async () => {
    const r = await climb({
      url: "https://reddit.com",
      plan: { good: ["reader"], bad: [] },
      fetchers: { direct: ok(), reader: ok() },
    });
    expect(r.rung).toBe("reader");
    expect(r.attempts).toHaveLength(1); // direct never ran
  });

  it("skips a rung memory says is hopeless, and says why", async () => {
    const r = await climb({
      url: "https://reddit.com",
      plan: { good: [], bad: [{ rung: "direct", outcome: "blocked" }] },
      fetchers: { direct: ok(), reader: ok() },
    });
    expect(r.rung).toBe("reader");
    expect(r.skipped).toEqual([{ rung: "direct", outcome: "blocked" }]);
    // Skipping must be explainable, not silent.
    expect(r.attempts.map((a) => a.rung)).not.toContain("direct");
  });

  it("NEVER memory-skips the relay — its availability is dynamic (login/connection)", async () => {
    // A single relay timeout used to record `relay:blocked` and then silently skip the
    // relay forever — so a domain the owner just logged into stayed unreachable. The
    // relay must be RETRIED, not skipped, when it's connected. (Live-caught 2026-08-03.)
    const r = await climb({
      url: "https://reddit.com",
      plan: { good: [], bad: [{ rung: "direct", outcome: "blocked" }, { rung: "relay", outcome: "blocked" }] },
      fetchers: { direct: ok(), relay: ok() },
    });
    expect(r.rung).toBe("relay"); // relay was tried despite memory saying blocked
    expect(r.attempts.map((a) => a.rung)).toContain("relay");
    expect(r.skipped.map((s) => s.rung)).not.toContain("relay"); // never in the skip list
    expect(r.skipped.map((s) => s.rung)).toContain("direct"); // other rungs still skip normally
  });

  it("reports every attempt so the fleet learns from failures too", async () => {
    const r = await climb({ url: "https://x.com", fetchers: { direct: blocked(), browser: ok() } });
    expect(r.reports).toEqual([
      { rung: "direct", outcome: "blocked" },
      { rung: "browser", outcome: "ok" },
    ]);
  });

  it("treats a rung that throws as a failed rung, not a failed climb", async () => {
    // One broken transport must not end the ladder.
    const r = await climb({ url: "https://x.com", fetchers: { direct: throws(), browser: ok() } });
    expect(r.ok).toBe(true);
    expect(r.attempts[0]!.verdict.reason).toMatch(/could not be reached/);
  });

  it("records a TIMEOUT as timeout, not blocked — transience the memory must not poison", async () => {
    // A relay that timed out (slow/hung) is not a refusal: recording it as `blocked`
    // is what silently killed the relay for a domain the owner had just logged into.
    const timesOut = () => async () => { throw new Error("relay fetch timed out after 25000ms"); };
    const r = await climb({ url: "https://x.com", fetchers: { relay: timesOut() } });
    expect(r.ok).toBe(false);
    expect(r.reports[0]!.outcome).toBe("timeout");
    expect(r.attempts[0]!.verdict.reason).toMatch(/did not answer in time/);
  });

  it("never returns unverified content", async () => {
    const r = await climb({ url: "https://x.com", fetchers: { direct: blocked(), reader: blocked() } });
    expect(r.ok).toBe(false);
    expect(r.content).toBeUndefined();
  });
});

describe("what the caller is told when nothing worked", () => {
  it("points at the relay for a network refusal", () => {
    expect(adviseFrom(["blocked"])).toMatch(/refuses this network|relay/);
  });

  it("refuses to suggest defeating bot management", () => {
    const advice = adviseFrom(["challenged"]);
    expect(advice).toMatch(/do not try to defeat it/i);
    expect(advice).not.toMatch(/stealth|spoof|bypass/i);
  });

  it("distinguishes a login wall from a block, because the fix differs", () => {
    expect(adviseFrom(["login"])).toMatch(/signed-in session/);
    expect(adviseFrom(["login"])).not.toMatch(/refuses this network/);
  });

  it("calls a timeout transient, not a refusal", () => {
    const advice = adviseFrom(["timeout"]);
    expect(advice).toMatch(/transient|retried/i);
    expect(advice).not.toMatch(/refuses this network/);
  });

  it("counts SKIPPED rungs toward the advice", async () => {
    // Memory already knows the source refuses this network. Not re-proving it must
    // not lose the conclusion.
    const r = await climb({
      url: "https://reddit.com",
      plan: { good: [], bad: [{ rung: "direct", outcome: "blocked" }] },
      fetchers: { direct: ok(), browser: shell() },
    });
    expect(r.ok).toBe(false);
    expect(r.advice).toMatch(/refuses this network/);
  });

  it("keeps api out of the mechanical order — choosing one is judgement", () => {
    expect(DEFAULT_ORDER).not.toContain("api");
  });
});
