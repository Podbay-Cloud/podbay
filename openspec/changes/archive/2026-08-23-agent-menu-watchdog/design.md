## Context

From the code audit (file:line). Every Claude menu already has a detector and, for most, a driver —
but the drivers are one-shot/event-armed, so a menu shown at the "wrong" moment hangs:

- **Detectors (shared):** `LOGIN_MENU_RE` (`greeter.ts:103`), `API_KEY_PROMPT_RE` (`greeter.ts:109`),
  `atBypassGate` (`pane.ts:54-57`), `atBlockingGate`/`BLOCKING_GATE_RE` (`pane.ts:29`) which folds in
  `select login method`, `use this api key`, `bypass permissions mode`, `yes, i accept`, `do you trust
  the files`, `do you want to proceed`. RC modal: `RC_ACTIVE_RE` (`greeter.ts:468`) + `isDialogOpen`
  on `waitingFor` (`greeter.ts:249`).
- **Drivers:** `driveLoginMenu` (`greeter.ts:148-206`), api-key accept/dismiss (`greeter.ts:358-376`,
  `178-184`), bypass accept (`greeter.ts:336-353`), RC-modal Enter (`greeter.ts:495-516`). All invoked
  from `startGreeter`/`startLoginAssistant`/`driveAddedAgentLogins`/`runGreeter`.
- **Orphan gates — detected, never answered:** `do you trust the files`, `do you want to proceed` —
  `atBlockingGate` true only makes `waitReady` *refuse to type* (`greeter.ts:377-383`); nothing clears
  them.
- **One-shot guards:** `greeterStarted` (`server.ts:2214`), `loginAssistantStarted`
  (`server.ts:2092`), `loginDriven`/`loginRespawned`/`rcEnabled` sets. Once fired, no re-inspection.
- **Respawn sites without a re-armed driver for the PRIMARY:** creds-present `/agent/restart`
  (`server.ts:804`) and the watchdog missing-window respawn (`server.ts:1263`). The creds-absent
  reconnect branch is the only one that re-arms (`server.ts:820-821`, the fix just shipped).
- **Tick loop:** `onTick` (`server.ts:2002-2037`) already captures the pane (`server.ts:2028`) and
  computes `paneHash` (`signals.ts:262`, used only by the recorder today). Only the codex daemon
  (`refreshCodexRc`, `server.ts:2411`) is genuinely per-tick self-healing — and it checks a *process*,
  never a menu. No "static pane + known gate → drive" logic exists.

## Goals / Non-Goals

**Goals:**
- No Claude flow (reconnect, resume, update, watchdog-respawn, added-agent, future ones) can leave the
  agent silently stuck at a known menu.
- Reuse the existing detectors + driver keystrokes — the watchdog is a new *trigger*, not new
  menu-answering logic.
- Bounded + idempotent: never fight a legitimately-open dialog; give up honestly (→ "needs you").
- Answer the two orphan gates, or surface them.

**Non-Goals:**
- Codex TUI menus: codex can't be reliably pane-scraped (`signals.ts:431-435`) — the watchdog is
  Claude-pane-driven. Codex menus stay suppressed at launch + covered by the daemon self-heal; stated
  explicitly, not silently skipped.
- Replacing the one-shot drivers — they still handle the happy path; the watchdog is the backstop.
- Auto-answering a genuinely owner-decision gate where guessing is wrong (see D3).

## Decisions

**D1 — A per-tick watchdog keyed on (known gate + static pane + no active driver).**
Add a step in `onTick` after `capturePane` (pane in hand) and after `advanceAddedAgents` (don't fight
mid-spawn windows — same ordering rationale as `server.ts:2033-2035`). For each agent window: capture
its pane, classify the gate (D2), require the pane to have been **unchanged for N ticks** (reuse
`paneHash`, e.g. N=2 ⇒ ~6s static) so we never race a menu that's still animating/advancing, confirm
no driver is currently mid-flight for that window, then drive the gate's answer.
- *Why static-for-N-ticks:* a menu the one-shot driver is actively clearing changes the pane each
  tick; only a truly *stuck* menu stays byte-identical. This is what makes the watchdog safe to run
  alongside the existing drivers without collisions.
- *Alternative:* fire on first detection — rejected: races the legit drivers + real user typing.

**D2 — Classify the gate to pick the right keystroke.**
`atBlockingGate` is a composite (any gate). Split detection so the watchdog knows WHICH gate is up
(login-method → Enter/subscription; api-key → mode-dependent; bypass → "2"+Enter; RC modal → Enter;
trust/proceed → D3), reusing the exact keystrokes the one-shot drivers use (factor them into small
named driver fns callable from both places). No new answering logic — same behavior, new caller.

**D3 — The two orphan gates: answer the safe one, surface the unsafe one.**
`do you trust the files` (the folder-trust prompt on `~/work`, always the owner's own repo) is safe to
accept — drive it. `do you want to proceed` is context-dependent (it fronts a variety of actions);
default to **surfacing it as a cockpit "needs you"** (via the existing `agentWaitingFor` path,
`server.ts:453`) rather than blindly answering. So: never a silent hang — either driven or explicitly
handed to the owner.

**D4 — Re-armable guards.**
Make `greeterStarted`/`loginAssistantStarted`/`loginDriven` clearable (a small `rearmDrivers(window)`)
so a re-spawned PRIMARY window (creds-present `/agent/restart`, watchdog window-respawn) can be driven
again. The watchdog itself doesn't depend on the guards (it drives directly), but re-arming keeps the
one-shot path correct too.

**D5 — Bounded, observable, honest.**
Per-gate attempt cap per window (like `MAX_BYPASS_ACCEPTS`/`MAX_API_KEY_ACCEPTS`, `greeter.ts:305,310`)
with backoff; every drive logs (`menu_watchdog_drove` / `menu_watchdog_gave_up`). Past the cap → the
window is marked "needs you", never retried into oblivion.

## Risks / Trade-offs

- **[Watchdog fights a driver or the user]** → the static-for-N-ticks gate + "no active driver" check
  means it only acts on a genuinely wedged pane; caps + logging bound any misfire.
- **[Auto-answering a gate the owner should decide]** → D3: only auto-answer the provably-safe gates
  (login-method for a subscription pod, trust of the owner's own `~/work`); everything ambiguous
  surfaces to the owner.
- **[Pane capture cost each tick]** → the pane is already captured per tick (`server.ts:2028`); the
  watchdog reuses it, adding only cheap regex tests. Per-window capture for multi-agent pods is the
  only extra cost, bounded by agent count.
- **[Claude changes its menu wording]** → a real risk (the reconnect bug rode a v2.1.215 menu). The
  watchdog centralizes the patterns so there's ONE place to update, and the "needs you" fallback means
  an unrecognized-but-stuck pane still gets surfaced, not hidden. (A future enhancement: alert when a
  pane is static+blocking-input but matches NO known gate — an early warning that the CLI changed.)
- **[Codex blind spot]** → accepted + documented (Non-Goals): codex menus are launch-suppressed; the
  watchdog is Claude-only.

## Open Questions

- **N (static ticks) + caps** — start N=2 (~6s) and cap=3/gate; tune from logs.
- **Should the "static+blocking but unknown gate" early-warning alert ship in v1** or as a follow-up?
  (Leaning follow-up — it's the CLI-changed tripwire, valuable but not required to fix the hang class.)
- **"do you want to proceed"** — is there a subset we CAN safely auto-answer (e.g. a known podbay-init
  prompt), or is surfacing always right? Decide from real captures.
