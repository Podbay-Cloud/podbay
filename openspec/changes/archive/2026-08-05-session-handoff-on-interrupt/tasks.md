## 1. The handoff skill (universal layer)

- [x] 1.1 Create `environments/_shared/universal/.claude/skills/handoff/` — the FIRST skill in the  — `environments/_shared/universal/.claude/skills/handoff/{SKILL,SOURCE}.md`
      universal layer (it ships `rules/` only today). Include `SKILL.md` and a `SOURCE.md` matching
      the provenance format the registry expects.
- [x] 1.2 Write the skill's instructions: write one note for THIS agent's window to  — `SKILL.md:15,19,26` — per-window note keyed on the tmux INDEX, never another window's file
      `~/.podbay/handoff/<window>.md`, covering what was being done, why, what is in flight, and the
      single next action. Require verifiable state (branch, commit, committed/pushed status, test or
      build result) over recollection, and require explicit uncertainty for any step whose outcome
      the agent never observed. Forbid claiming completion it cannot confirm.
- [x] 1.3 Keep it short and bounded — the note is read by a resuming agent AND by the owner, and it  — `SKILL.md:37-39` — "a long note is a failed note"
      is written under a timeout, so a long note is a failed note.
- [x] 1.4 Regenerate the skills index and confirm the pre-push drift-guard passes  — `skills-registry.generated.ts:308`; drift-guard wired at `scripts/git-hooks/pre-push:40`, re-run clean (35 shipped)
      (`pnpm skills:registry`, `node scripts/skills/build-registry.mjs --check`).

## 2. Read-on-resume instruction (universal rules)

- [x] 2.1 Add the read-on-resume rule to `environments/_shared/universal/.claude/rules/` — read the  — `environments/_shared/universal/.claude/rules/resume-from-handoff.md`
      note for this window before starting work; treat it as authoritative about what was in flight
      where it disagrees with the transcript; silently continue when absent.
- [x] 2.2 Verify this reaches Codex through the existing AGENTS.md translation, and does NOT depend  — layer → `/etc/podbay/claude/rules/` (`fly/init.ts:104-107`), globbed into AGENTS.md by `init.sh:325-333`; independent of RESUME_TRIGGER
      on the compiled `RESUME_TRIGGER` (`pod-agent/src/boot.ts:35`) — no image rebuild.

## 3. Pre-flight trigger (control plane)

- [x] 3.1 Add a best-effort `requestHandoff(podId)` helper: enumerate live agent windows, type the  — `packages/control-plane/src/handoff.ts:74`, windows by index `:52-58`, reuses `paneAcceptsInput` rather than re-implementing the gate check
      handoff request into each live window reusing the greeter's existing dead-pane and
      blocking-gate hardening (`BLOCKING_GATE_RE`) rather than re-implementing detection.
- [x] 3.2 Bound it with a timeout (default ~15s, configurable) and wrap every call so a throw,  — `handoff.ts:22` (60s, deliberately raised from the proposed 15s — rationale at `:14-21`), deadline `:79,:118`, never rethrows `:136-140`
      timeout, or missing agent is logged and swallowed.
- [x] 3.3 Call it on the update path after owner confirmation and before `provider.updateImage`.  — `service.ts:1323`, before `provider.updateImage` at `:1345`
- [x] 3.4 Call it on the suspend path before the stop.  — `service.ts:806`, before `providerFor(...).sleep(id)` at `:807`
- [x] 3.5 Confirm the added latency is covered by the existing durable update-progress reporting so  — durable `updateStage: "handoff"` at `service.ts:1322`, surfaced through the existing progress reporter `:1298`
      the cockpit does not look frozen while waiting.

## 4. Tests

- [x] 4.1 Unit-test the control-plane hook: handoff success, timeout, throw, and no-live-agent — the  — `test/handoff.test.ts:32,71,90,101`
      lifecycle action completes identically in ALL four, and no error reaches the owner.
- [x] 4.2 Test per-window note paths so one window cannot clobber another's note.  — `test/handoff.test.ts:107` — distinct `0.md` / `1.md`
- [x] 4.3 Test that a blocking gate or dead pane is refused rather than typed into.  — `test/handoff.test.ts:50,61` — both assert no send-keys
- [x] 4.4 Assert the note path lives under the persistent home volume, since a note on ephemeral  — `test/handoff.test.ts:128` — asserts the note path is under `/home/dev/`
      rootfs would silently vanish on exactly the event it exists for.

## 5. Verify on a real pod (NOT just tests)

- [x] 5.1 Deploy web + gateway (no image rebuild) and launch a fresh pod; confirm the universal layer
      seeds the new `skills/handoff/` directory. The env `.claude` layer has regressed before
      (2026-07-24 seed-marker bug meant skills reached zero Incus pods), so verify on a live pod.
      - PARTIAL 2026-07-30: the layer IS delivered — `/etc/podbay/claude/skills/handoff/` and
        `/etc/podbay/claude/rules/resume-from-handoff.md` are present on `everyday-harrier-ae1b`.
      - VERIFIED 2026-08-04: on a live pod the layer is not only delivered at `/etc/podbay/claude/…`
        but SEEDED into the agent's dir — `~/.claude/skills/handoff/{SKILL,SOURCE}.md` present. That
        is the exact 2026-07-24 regression path (skill reaching the agent), now working. The one
        sliver still unexercised is a pristine fresh-LAUNCH (this pod reached it via an update); the
        seed mechanism itself is proven.
- [x] 5.2 Trigger an update with a working agent; confirm a note is written, survives the recreate,
      and the resumed session reads it before acting.
      — VERIFIED first-hand 2026-07-30: `~/.podbay/handoff/0.md` on `everyday-harrier-ae1b`,
        written 2026-07-28 by an agent the control plane typed `/handoff` into before an update.
        It survived that recreate and every restart since, and was read on resume days later.
- [ ] 5.3 Trigger an update with a deliberately busy/unresponsive agent; confirm the update is not
      delayed beyond the timeout and completes normally with a stale-or-absent note.
      - Unverified: needs a deliberately wedged agent. The unit tests cover the refusal path
        (`handoff.test.ts:50,61`), but nothing has exercised it against a real stuck pane.
- [ ] 5.4 Verify on a Codex pod that the same path works with no Claude-specific branch.
      - Unverified on a codex pod. Note this is now MORE testable than when written: since
        2026-07-29 codex secondaries get the AGENTS.md rules block, so the resume rule reaches them.
- [x] 5.5 Confirm the owner can open the note directly on the volume and understand it without
      tooling.
      - VERIFIED 2026-08-04: read `~/.podbay/handoff/0.md` on a live pod — a plain, dev-owned markdown
        note with a clear structure (What I was doing / State (verifiable: branch@commit, deploy
        versions) / In flight — UNCONFIRMED / Next). Fully understandable by opening the file; no
        tooling needed. Two per-window notes (`0.md`, `1.md`) also confirm per-window separation live.

## 6. Documentation

- [x] 6.1 Record the note location and format where the owner will look for it. — `docs/runbooks/session-handoff.md` (written 2026-07-30; the path was previously only in the SKILL, the design doc and 0audit.md, i.e. nowhere an owner would look).
- [x] 6.2 Note in `0audit.md` that unplanned interrupts (crash, host reboot) leave no fresh note by  — `0audit.md:299-301` — crash/reboot leaves no note BY DESIGN; continuous journaling considered and rejected for v1
      design, and that continuous journaling was considered and deferred.
