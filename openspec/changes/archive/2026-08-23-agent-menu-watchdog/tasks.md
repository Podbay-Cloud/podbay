# Tasks

Image-baked (pod-agent) → rebuild + verify on a scratch pod before shipping. Reuses existing
detectors + driver keystrokes; the watchdog is a new trigger, not new answering logic.

## 1. Factor the per-gate drivers so both the one-shot path and the watchdog can call them

- [ ] 1.1 Extract named driver fns from the inline logic: `driveLoginMenuAnswer`, `driveApiKeyAnswer`
      (mode-aware), `driveBypassAnswer`, `driveRcModalAnswer` — from `greeter.ts` (`148-206`, `358-376`,
      `336-353`, `495-516`). Same keystrokes, callable standalone.
- [ ] 1.2 Split gate CLASSIFICATION out of the composite `atBlockingGate` (`pane.ts:29`) so a caller
      learns WHICH gate is showing (login-method | api-key | bypass | trust | proceed | rc-modal),
      keeping `atBlockingGate` for the existing "refuse to type" callers.

## 2. The per-tick watchdog

- [ ] 2.1 Add a watchdog step in `onTick` after `capturePane` + `advanceAddedAgents` (`server.ts:2028`
      / `:2033-2035` ordering). For each agent window: classify the gate, require the pane static for N
      ticks (reuse `paneHash`, `signals.ts:262`), confirm no driver mid-flight, then call the matching
      driver from §1.
- [ ] 2.2 Per-gate attempt cap per window (mirror `MAX_BYPASS_ACCEPTS`/`MAX_API_KEY_ACCEPTS`) + backoff;
      log `menu_watchdog_drove` / `menu_watchdog_gave_up`.
- [ ] 2.3 Only auto-answer the provably-safe gates (login-method on a subscription pod; trust of the
      owner's own `~/work`). Ambiguous → §3 surface.

## 3. Orphan gates + honest fallback

- [ ] 3.1 Answer the folder-trust prompt (`do you trust the files`) — drive it instead of only refusing
      to type (`greeter.ts:377-383`).
- [ ] 3.2 A gate past its cap, or a not-safe-to-answer gate (`do you want to proceed`), surfaces as a
      cockpit "needs you" via the existing `agentWaitingFor` signal (`server.ts:453`) — never a silent
      hang.

## 4. Re-armable one-shot guards (D4)

- [ ] 4.1 Add `rearmDrivers(window)` clearing `greeterStarted`/`loginAssistantStarted`/`loginDriven` for
      a window, called on a PRIMARY respawn (creds-present `/agent/restart` `server.ts:804`, watchdog
      window-respawn `server.ts:1263`) so a re-spawned primary is drivable again.

## 5. Codex scope (explicit)

- [ ] 5.1 Watchdog is Claude-pane-driven; codex menus stay launch-suppressed (`boot.ts:114-124`) +
      daemon self-heal (`refreshCodexRc`). Note the codex pane-scrape limitation
      (`signals.ts:431-435`) in a comment + the spec — do not silently skip it.

## 6. Verify + ship

- [ ] 6.1 Unit-test the classifier (each gate string → right class) + the static-pane trigger (pane
      changes → no fire; static N ticks → fire).
- [ ] 6.2 Scratch pod: reproduce each stuck-menu scenario (reconnect creds-present, watchdog respawn,
      trust prompt) → confirm the watchdog drives/surfaces each. Include the CLI-changed case: a static
      blocking pane matching NO known gate → surfaced, not hidden (if the early-warning ships).
- [ ] 6.3 Image rebuild via `build-and-record.sh` + digest bump; spec + 0audit updated in-commit.
- [ ] 6.4 `openspec archive agent-menu-watchdog` once shipped.
