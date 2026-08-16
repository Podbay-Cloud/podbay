## 1. Control plane — add-agent

- [x] 1.1 `addAgent(ownerId, podId, agent)`: owner-scoped; validate the agent is declared by the env
      and not already present; append to `pods.agents`; idempotent (adding an existing agent is a
      no-op, never a second spawn). Emit an event for the audit trail.
- [x] 1.2 Refuse a duplicate TYPE explicitly (two of one CLI share its config + the workspace).
- [x] 1.3 Unit tests: success, duplicate → no-op, undeclared agent → refused, non-owner → not_found,
      and the existing agent's session untouched.

## 2. Pod side — spawn into a window on a LIVE pod

- [x] 2.1 Provider/pod-agent path to start an agent in a NEW tmux window on a running pod (reuse
      slice 1's window primitive), register it as that agent's window (slice 2's targeting), and
      return the window index.
- [x] 2.2 For an added Codex: ensure the RC daemon starts for it (existing `ensureCodexDaemon`) once
      it has credentials.
- [x] 2.3 The added agent takes the RESUME path, not the env's first-run kickoff — it boots into a
      worked-in pod. Point it at the handoff notes so it can orient on what the other agent did.
- [x] 2.4 Verify no restart: the pre-existing agent's session survives the add (this is the whole
      point — recreating would kill the session the user is adding a partner to).

## 3. Cockpit — the reorganization

- [x] 3.1 Ready-state: ONE remote-control status block naming connected agents (1 or 2), replacing
      the current single-agent assumption.
- [x] 3.2 Claude keeps its direct `Continue in Claude` hand-off when a session URL exists.
- [x] 3.3 Codex flow behind progressive disclosure: "Connect Codex" (not connected) / "Pair another
      device" (connected) expanding `CodexPairPanel` in place — not permanently rendered.
- [x] 3.4 "Add agent" affordance, shown only when the env declares an agent the pod lacks.
- [x] 3.5 State the shared-workspace/switching-first model at the moment the second agent is added.
- [x] 3.6 Mobile check (e2e at 390px: two agent cards, no horizontal scroll): two agents must not make the ready state a scroll-fest on a phone.
- [x] 3.7 REDESIGN (owner feedback 2026-07-28): one card per agent, explicit state machines,
      devices in the Codex status line, wizard open/close inside the card, real RC off/on switch,
      terminal demoted to Admin (sign-in deep-links only), per-agent /healthz truth + degraded
      mode for old images.

## 4. Codex RC naming

- [x] 4.1 CONFIRMED on a live device 2026-07-29: the Codex app labels a pod by the remote-control
      enrollment's `server_name`, captured from the HOSTNAME at first enrollment and fixed
      server-side thereafter. `deviceName` (reported at pairing) is NOT what the app displays.
      Original wording of 4.1 before building on it: does the Codex app
      display the pod's hostname? (Evidence so far: the RC binary reads `/proc/sys/kernel/hostname`
      and a pod's hostname already equals its slug — suggestive, NOT proof.)
- [x] 4.2 (was wrongly ticked before it was done — the earlier change set `deviceName`, not the
      hostname.) Now: init.sh sets the hostname to the sanitized user-chosen pod name (at boot and on
      rename). Note it needs a recreate/restart to take effect.
- [x] 4.3 Limitation recorded (0audit + pod-boot spec): a pod RENAMED after its first enrollment
      keeps the old label in the Codex app, and no workaround exists from the pod side. Original 4.3 in 0audit + the spec scenario, and do NOT apply an
      unsupported workaround.

## 5. Verify on a real pod

- [x] 5.1 Add Codex to a live Claude pod: both run, tabs switch, Claude's session survived.
- [ ] 5.2 NEEDS THE OWNER (a real device): complete the Codex login + pairing from the cockpit's disclosure; confirm the connected
      state then shows both agents in ONE block.
- [x] 5.3 Add Claude to a live Codex pod (the mirror case — do not assume symmetry, test it).
- [ ] 5.4 NEEDS THE OWNER (watching a real session): confirm the added agent oriented from existing context instead of re-greeting.

## 6. Docs

- [x] 6.1 Update `docs/plans/multi-agent-plan.md`: slice 3 shipped, with what was actually built.
- [x] 6.2 Record the Codex naming outcome (mechanism or limitation) in 0audit.
