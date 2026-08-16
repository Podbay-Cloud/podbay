import { describe, it, expect, afterEach } from "vitest";
import { PtySession } from "../src/session.js";
import { extractLinks } from "../src/signals.js";

const sessions: PtySession[] = [];
function track(s: PtySession) {
  sessions.push(s);
  return s;
}
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.killSession();
});

const uniq = () => `pbtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

/** Collect output until it contains `needle` or times out. */
function waitFor(s: PtySession, needle: string, ms = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const off = s.onData((d) => {
      buf += d;
      if (buf.includes(needle)) {
        off();
        resolve(buf);
      }
    });
    setTimeout(() => {
      off();
      reject(new Error(`timeout waiting for "${needle}"; got: ${buf.slice(-200)}`));
    }, ms);
  });
}

describe("PtySession (real PTY + tmux)", () => {
  it("round-trips input and output (8.1)", async () => {
    const s = track(new PtySession({ sessionName: uniq(), bootCommand: "bash --norc" }));
    await new Promise((r) => setTimeout(r, 400));
    s.write("echo pod_hi_123\n");
    const out = await waitFor(s, "pod_hi_123");
    expect(out).toContain("pod_hi_123");
  });

  it("resets idle on activity (8.6)", async () => {
    const s = track(new PtySession({ sessionName: uniq(), bootCommand: "bash --norc" }));
    // Idle accrues from the last OUTPUT (the shell printing its prompt), NOT from
    // construction — so sleeping a fixed 500ms does not guarantee 500ms of idle. On a
    // loaded CI runner the prompt can land >100ms in, which made this read 390 and fail a
    // >= 400 assertion about behaviour that was perfectly correct. Wait for idle to
    // actually accumulate instead of assuming the clock.
    const deadline = Date.now() + 5_000;
    while (s.idleMs() < 400 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const before = s.idleMs();
    expect(before).toBeGreaterThanOrEqual(400);
    s.write("echo x\n");
    await new Promise((r) => setTimeout(r, 50));
    expect(s.idleMs()).toBeLessThan(before);
  });

  it("reconnect re-attaches to the same tmux session (8.3)", async () => {
    const name = uniq();
    const s1 = track(new PtySession({ sessionName: name, bootCommand: "bash --norc" }));
    await new Promise((r) => setTimeout(r, 400));
    s1.write("echo marker_persist\n");
    await waitFor(s1, "marker_persist");
    s1.dispose(); // detach, do NOT kill the tmux session

    // New attach to the same session sees prior scrollback.
    const s2 = track(new PtySession({ sessionName: name }));
    await new Promise((r) => setTimeout(r, 500));
    const links = await extractLinks(name); // uses capture-pane on the same session
    expect(links).toBeInstanceOf(Array);
    // capture the buffer directly to assert persistence
    const { execFileSync } = await import("node:child_process");
    const buf = execFileSync("tmux", ["capture-pane", "-pJ", "-S", "-200", "-t", name]).toString();
    expect(buf).toContain("marker_persist");
  });

  it("recovers a wrapped URL whole via capture-pane -J (8.5)", async () => {
    const name = uniq();
    const s = track(new PtySession({ sessionName: name, cols: 40, rows: 10, bootCommand: "bash --norc" }));
    await new Promise((r) => setTimeout(r, 400));
    const url = "https://example.com/oauth/authorize?code=" + "a".repeat(80) + "&state=xyz";
    s.write(`printf '%s\\n' "${url}"\n`);
    await new Promise((r) => setTimeout(r, 500));
    const links = await extractLinks(name);
    expect(links.some((u) => u === url)).toBe(true);
  });

  it("rejoins a TUI-drawn URL split across separate full-width rows (8.5b)", async () => {
    // TUIs (e.g. the Claude login box) print long URLs as SEPARATE rows, each
    // exactly pane-width — tmux never "wrapped" them, so -J can't join. Emulate
    // with printf of hard newline-separated full-width segments at cols=40.
    const name = uniq();
    const s = track(new PtySession({ sessionName: name, cols: 40, rows: 12, bootCommand: "bash --norc" }));
    await new Promise((r) => setTimeout(r, 400));
    const head = "https://claude.com/cai/oauth/authorize?c"; // 40 chars: fills the row
    const mid = "ode=true&client_id=9d1c250a-e61b-44d9-88"; // 40 chars
    const tail = "ed&code_challenge=abc123&state=xyz"; // short tail row
    const full = head + mid + tail;
    s.write(`printf '%s\\n' "${head}" "${mid}" "${tail}"\n`);
    await new Promise((r) => setTimeout(r, 500));
    const links = await extractLinks(name);
    expect(links).toContain(full);
    // the truncated first-row fragment must NOT be offered alongside it
    expect(links).not.toContain(head);
  });
});
