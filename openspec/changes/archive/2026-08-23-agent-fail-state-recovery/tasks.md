# Tasks

Image-baked (pod-agent) + a small web reflect. Verify on a scratch pod (simulate a bridge death /
re-login) before shipping. Composes with the menu-watchdog's per-tick self-healing loop.

## 1. Live signals (shared, testable)

- [ ] 1.1 Auth-failure markers in `shared/pane.ts` (one place): `authFailureInPane(text)` matching
      "login expired" / "please run /login" / "worker auth expired" / the RC "sign in again" line.
      Unit-test against real strings.
- [ ] 1.2 RC-dead marker(s) for the pane, if the CLI prints one on bridge death — else rely on the
      live bridge-state read (§2.2).

## 2. Live health in agentStates (server.ts:1820-1835)

- [ ] 2.1 Add `needsReauth` (live) to each agent's healthz, from `authFailureInPane` on that window's
      pane, debounced (reuse the menu-watchdog paneHash/static-ticks). INDEPENDENT of
      `credentialState.expired`; clears when authed again.
- [ ] 2.2 Make `rcActive` a LIVE check: derive from the current `sessionStateFromDisk().url` (alive
      pid) + RC-dead markers, not the sticky captured-URL boolean. Keep `sessionUrl` for the link.

## 3. Auto-restore RC (the recoverable half)

- [ ] 3.1 Per-tick fail-state check (beside `menuWatchdog`): if agent authed AND `!needsReauth` AND RC
      live-dead AND not at a menu AND no greeter running → call the existing `reenableRemoteControl`
      (RC-only greeter). Bounded per window (cap ~3 + backoff); logs `rc_autorestore` /
      `rc_autorestore_gave_up`.
- [ ] 3.2 Covers the post-re-login case automatically (login succeeds → authed → RC reads dead →
      restore fires). Verify it does NOT fire while `needsReauth` or at a menu (gate on §2.1 + the
      menu classifier).

## 4. Surface honestly (pod-observability)

- [ ] 4.1 `health-checks.ts`: an `agent-needs-reauth` issue from `needsReauth` (warn, agent-scoped),
      distinct from the file-based `agent-login-expired`; optional "remote control could not be
      restored" when §3.1 gives up.
- [ ] 4.2 apps/web cockpit/doctor: reflect live `rcActive` + the `needsReauth`/reconnect state (the
      existing Reconnect action already handles the wipe→/login→menu-driven→auto-RC path).

## 5. Verify + ship

- [ ] 5.1 Unit tests: `authFailureInPane` (each marker → true; a healthy prompt → false); the
      auto-restore predicate (authed+rc-dead+not-menu → fire; logged-out/at-menu → no fire).
- [ ] 5.2 Scratch pod: (a) establish RC, kill the bridge worker → confirm `rcActive` flips false AND
      the pod auto-re-runs `/remote-control` and recovers; (b) simulate an auth-failure pane → confirm
      `needsReauth` surfaces despite a future file expiry, and does NOT auto-run RC; (c) re-login →
      confirm RC auto-restores.
- [ ] 5.3 Image rebuild via `build-and-record.sh` + digest bump; specs + 0audit updated in-commit;
      web deploy for the cockpit/doctor reflect.
- [ ] 5.4 `openspec archive agent-fail-state-recovery` once shipped.
