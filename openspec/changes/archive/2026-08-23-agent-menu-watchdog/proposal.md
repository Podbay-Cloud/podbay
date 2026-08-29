## Why

Podbay's automation drives the Claude CLI's interactive menus (login-method select, api-key prompt,
bypass gate, remote-control modal) so an owner never has to touch the terminal. But every driver is
**one-shot / event-driven** — armed at a specific moment (boot, added-agent, a specific respawn). When
a flow puts the agent back at a menu at a moment no driver is armed, it **hangs there silently**, and
the cockpit waits forever. This just bit the **Reconnect** flow live (2026-08-22): `/agent/restart`
respawned Claude into `claude /login`, nothing drove the "Select login method" menu, and the cockpit
stuck on "Getting Claude's sign-in link…". The audit found this is not a one-off — there are sibling
gaps (a creds-present restart or a watchdog window-respawn can land the PRIMARY agent on a fresh
bypass/RC menu with the one-shot greeter guard already spent) and two gates we *detect but never
answer* at all ("do you trust the files", "do you want to proceed"). The durable fix is a
**self-healing watchdog** that, each tick, notices a known menu sitting undriven and drives it — so no
current or future flow can wedge the agent at a menu.

## What Changes

- **A per-tick menu watchdog** in the pod-agent: after the pane is captured each tick, for every agent
  window, test it against the known blocking-gate predicates (login-method, api-key, bypass,
  trust-folder, "do you want to proceed", the RC "dialog open" modal). If a known gate is showing, the
  pane has been **static for N ticks**, and no driver is currently active for that window, **drive the
  correct answer** (the same keystrokes the existing one-shot drivers use) — bounded with per-gate
  attempt caps so it never fights a legitimately-open dialog forever.
- **Answer the two orphaned gates** ("do you trust the files", "do you want to proceed") — today
  `atBlockingGate` only makes the greeter *refuse to type*; nothing clears them. The watchdog gives
  them a driver (or, where auto-answering is unsafe, surfaces an explicit "needs you" state instead of
  a silent hang).
- **Re-armable drivers:** make the one-shot guards (`greeterStarted`, `loginAssistantStarted`,
  `loginDriven`) readable/clearable so the watchdog can act on a re-spawned primary window instead of
  being blocked by a guard that already fired earlier in the process's life.
- **Honest fallback:** a gate the watchdog can't safely auto-answer (or that persists past its cap)
  becomes a clear cockpit "needs you" signal — never an indefinite silent wait.
- *Codex caveat (explicit non-goal below):* codex's TUI can't be reliably pane-scraped (stripped
  binary, often unrendered), so the watchdog is Claude-pane-driven; codex menus stay suppressed at
  launch (existing flags) + covered by the daemon self-heal, and this is stated, not silently skipped.

## Capabilities

### New Capabilities
<!-- none — hardens the existing pod-agent capability -->

### Modified Capabilities
- `pod-agent`: the agent's interactive menus are kept unstuck by a self-healing watchdog, not only by
  one-shot drivers — a known menu that sits undriven is driven (or surfaced as "needs you"), so no
  flow silently hangs the agent at a prompt.

## Impact

- **packages/pod-agent/src/server.ts** — a new watchdog step in/after `onTick` (post-`capturePane`);
  make the greeter/login one-shot guards re-armable; wire per-window gate detection + driving.
- **packages/pod-agent/src/greeter.ts** — factor the per-gate "answer" keystrokes (login-menu,
  api-key, bypass, RC-modal) into reusable drivers the watchdog can call; add drivers for the two
  orphaned gates.
- **packages/shared/src/pane.ts** — the gate predicates are already here (`atBlockingGate`,
  `atBypassGate`, `LOGIN_MENU_RE`, `API_KEY_PROMPT_RE`); may split the composite so the watchdog can
  tell WHICH gate is showing (to pick the right answer).
- **Signals reused (no new source):** `capturePane`, `paneHash` (static-pane detection),
  `sessionStateFromDisk().waitingFor`/`status`.
