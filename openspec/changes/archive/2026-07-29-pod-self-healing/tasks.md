## 1. Watchdog (S1)

- [x] 1.1 Declared-shape assertions in the tick: session alive, one window per `spec.agents`, agent
      process live in each, sidecars up. Read the shape from the spec, not the DB — the pod is the
      truth about what runs on it.
- [x] 1.2 Repair with a cap: 3 per target per rolling hour, exponential backoff (5s → 30s → 5m),
      then mark unhealthy with the reason. Unit-tested: MUST NOT loop forever, and a capped target
      MUST NOT block others.
- [x] 1.3 Emit a pod event per repair and per exhausted cap (`agent_respawned`, `session_recovered`,
      `repair_gave_up`).
- [x] 1.4 Session recovery via the BOOT path (exit → service restart), capped. Verify on a real pod
      by killing the tmux server and watching it come back with every agent — the same experiment
      that produced this change.
- [x] 1.5 Confirm the watchdog does NOT interfere with the login → respawn → greeter sequence for
      either a primary or an ADDED agent (it must not repair a window mid-login).

## 2. Health reporting (S2)

- [x] 2.1 `/healthz` `issues[]` (id, severity, title, detail, fixable, agent?).
- [x] 2.2 Checks: disk floor, session alive, agent windows, sidecars, app port, repair-gave-up.
- [x] 2.3 Provider + control-plane passthrough, owner-scoped.
- [x] 2.4 Cockpit health strip (hidden when green) + Admin check list with last-run.

## 3. Doctor (S3)

- [x] 3.1 `podbay doctor` CLI in the image: check registry (`id, title, severity, probe, fix?`),
      human table + `--json`.
- [x] 3.2 Read-only checks covering the failure inventory (disk first — it breaks other fixes).
- [x] 3.3 Safe-tier fixes; `POST /doctor {fix?}` on the pod-agent as transport.
- [x] 3.4 Cockpit Admin "Run doctor" with a staged result view.
- [x] 3.5 Runtime-rules entry so a pod's own agent knows the verb exists.

## 4. Invasive fixes (S4)

- [x] 4.1 Back-up-before-replace helper (`<file>.broken-<ts>`) — non-negotiable prerequisite.
- [x] 4.2 Config restore from the env template; dependency reinstall. Behind explicit confirms.
- [x] 4.3 Credentials: detect and route to the sign-in flow. Never "repair".

## 5. Verify

- [x] 5.1 e2e (now runnable in-pod): a pod whose agent window is killed shows "not running" and
      recovers.
- [x] 5.2 Live: kill an agent window / the tmux server on the throwaway pod; it returns with all agents, and the
      events show what happened.
- [x] 5.3 Dogfood pass for the "fighting the user" risk — if respawning a deliberate quit is
      annoying in practice, flip the default to surface-only and record why.
