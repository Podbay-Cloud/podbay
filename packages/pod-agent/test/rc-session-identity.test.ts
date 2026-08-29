import { describe, it, expect } from "vitest";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  decideRcRename,
  hashRcSessionId,
  readRcSessionHash,
  writeRcSessionHash,
  resolveRcRename,
} from "../src/rc-session-identity.js";

/**
 * Pure decision logic for RC-session-identity-driven `/rename`. This is the
 * fix for the pod-agent-only-restart clobber bug: `coldStart` was a boolean
 * derived from "did the pod-agent PROCESS restart", but the tmux-hosted Claude
 * process (and therefore the RC session) can survive a pod-agent bounce. The
 * OLD `coldStart: true` (set unconditionally in startGreeter/startAddedAgentGreeter)
 * would send `/rename` again in that case and could clobber a title the owner
 * set themselves in the Claude app in the meantime — because `coldStart` cannot
 * tell "process restarted" from "RC session changed identity". These tests
 * exercise the REPLACEMENT: comparing the currently observed RC session id
 * against a persisted hash of the last-observed id.
 */
describe("decideRcRename (pure identity-transition logic)", () => {
  it("same observed session id as last time → do NOT rename (preserves an owner rename)", () => {
    // This is exactly the pod-agent-only-restart case: Claude/tmux never died, so
    // the SAME bridge session id is observed again. The old coldStart:true logic
    // would have renamed here regardless — that was the bug.
    const priorHash = hashRcSessionId("https://claude.ai/code/session_abc123");
    const d = decideRcRename("https://claude.ai/code/session_abc123", priorHash);
    expect(d.shouldRename).toBe(false);
    expect(d.hashToPersist).toBeUndefined();
  });

  it("different observed session id than last time → rename (replacement session)", () => {
    const priorHash = hashRcSessionId("https://claude.ai/code/session_abc123");
    const d = decideRcRename("https://claude.ai/code/session_XYZ999", priorHash);
    expect(d.shouldRename).toBe(true);
    expect(d.hashToPersist).toBe(hashRcSessionId("https://claude.ai/code/session_XYZ999"));
  });

  it("no prior hash at all → rename (first-ever observed session)", () => {
    const d = decideRcRename("https://claude.ai/code/session_first", undefined);
    expect(d.shouldRename).toBe(true);
    expect(d.hashToPersist).toBe(hashRcSessionId("https://claude.ai/code/session_first"));
  });

  it("no CURRENT observable id but a PRIOR hash exists → do NOT rename, do NOT touch persisted state", () => {
    // We have recorded a session for this pod before and cannot prove the current one differs,
    // so renaming risks clobbering a title the owner set themselves in the Claude app.
    // /remote-control <title> (already sent earlier in the greeter) is the best-effort path.
    const priorHash = hashRcSessionId("https://claude.ai/code/session_abc123");
    const d = decideRcRename(undefined, priorHash);
    expect(d.shouldRename).toBe(false);
    expect(d.hashToPersist).toBeUndefined();
  });

  // REGRESSION (CI real-tmux greeter.test.ts, 2026-08-27): the greeter accepts RC-active from the
  // PANE ("remote control is active · …/session_x") as well as from the session file, so it can
  // legitimately reach the rename step while sessionStateFromDisk() still has nothing to read.
  // Skipping the rename there silently dropped the entire cold-restart naming fix (a fresh session
  // left as "Resume session context"). With no prior hash there is nothing a rename could clobber,
  // so it must go ahead as best effort.
  it("no current id and NO prior hash → RENAME anyway (nothing recorded ⇒ nothing to clobber)", () => {
    const d = decideRcRename(undefined, undefined);
    expect(d.shouldRename).toBe(true);
    expect(d.hashToPersist).toBeUndefined(); // still no id to record
  });

  it("never persists or leaks the raw session id/url — only a hash", () => {
    const id = "https://claude.ai/code/session_super-secret-id";
    const d = decideRcRename(id, undefined);
    expect(d.hashToPersist).not.toContain("session_super-secret-id");
    expect(d.hashToPersist).not.toContain("claude.ai");
    expect(d.hashToPersist).toMatch(/^[0-9a-f]+$/); // hex digest, not the URL
  });
});

describe("hashRcSessionId", () => {
  it("is deterministic and distinguishes different ids", () => {
    expect(hashRcSessionId("a")).toBe(hashRcSessionId("a"));
    expect(hashRcSessionId("a")).not.toBe(hashRcSessionId("b"));
  });
});

describe("readRcSessionHash / writeRcSessionHash (state file)", () => {
  const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), "rc-hash-")), "rc-session-hash");

  it("returns undefined when no state file exists yet", () => {
    expect(readRcSessionHash(tmpFile())).toBeUndefined();
  });

  it("round-trips a written hash", () => {
    const p = tmpFile();
    writeRcSessionHash("deadbeef", p);
    expect(readRcSessionHash(p)).toBe("deadbeef");
  });

  it("writes the state file with mode 0600 (owner read/write only)", () => {
    const p = tmpFile();
    writeRcSessionHash("deadbeef", p);
    const mode = statSync(p).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("re-asserts 0600 even if the file pre-existed with looser permissions", () => {
    const p = tmpFile();
    writeFileSync(p, "stale", { mode: 0o644 });
    writeRcSessionHash("deadbeef", p);
    const mode = statSync(p).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("tolerates a corrupt/unreadable state file by treating it as unobservable", () => {
    const p = path.join(mkdtempSync(path.join(tmpdir(), "rc-hash-")), "missing-dir", "rc-session-hash");
    expect(readRcSessionHash(p)).toBeUndefined();
  });
});

describe("resolveRcRename (read + decide + persist in one call, for greeter integration)", () => {
  const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), "rc-hash-")), "rc-session-hash");

  it("first observation: renames and persists the hash for next time", () => {
    const p = tmpFile();
    const d1 = resolveRcRename("https://claude.ai/code/session_one", p);
    expect(d1.shouldRename).toBe(true);
    expect(readRcSessionHash(p)).toBe(hashRcSessionId("https://claude.ai/code/session_one"));
  });

  it("second observation of the SAME id: does not rename again (pod-agent-only-restart case)", () => {
    const p = tmpFile();
    resolveRcRename("https://claude.ai/code/session_one", p); // simulates the earlier boot
    const d2 = resolveRcRename("https://claude.ai/code/session_one", p); // pod-agent restarts, same RC session
    expect(d2.shouldRename).toBe(false);
  });

  it("observing a REPLACEMENT id after a prior one: renames again and updates the persisted hash", () => {
    const p = tmpFile();
    resolveRcRename("https://claude.ai/code/session_one", p);
    const d2 = resolveRcRename("https://claude.ai/code/session_two", p); // fresh/replacement RC session
    expect(d2.shouldRename).toBe(true);
    expect(readRcSessionHash(p)).toBe(hashRcSessionId("https://claude.ai/code/session_two"));
  });

  it("an unobservable id between two real observations leaves the persisted hash untouched", () => {
    const p = tmpFile();
    resolveRcRename("https://claude.ai/code/session_one", p);
    const during = resolveRcRename(undefined, p); // e.g. mid-boot, no session file yet
    expect(during.shouldRename).toBe(false);
    expect(readRcSessionHash(p)).toBe(hashRcSessionId("https://claude.ai/code/session_one")); // untouched
    // and the SAME session resuming afterward is still recognized as "same" — no rename
    const after = resolveRcRename("https://claude.ai/code/session_one", p);
    expect(after.shouldRename).toBe(false);
  });
});
