## Why

A pod's agent set is fixed at launch. `pods.agents` (jsonb, migration 0023) is written once by the
launch picker and never changed — there is no "add an agent" path in the control plane, so a Claude
pod can never gain Codex and vice versa. Vels wants both on one pod: they share `~/work`, and the
two agents are genuinely complementary.

The cockpit is also single-agent by construction. Once Claude connects it shows one **Continue in
Claude** button; Codex's flow is materially more involved (device-code login, an out-of-band RC
daemon, and a pairing wizard with a QR code and confirmed devices). Rendering both flows as
siblings would double the cockpit's busiest surface at exactly the moment a user is least oriented.

Multi-agent slices 1 and 2 already shipped the substrate — tmux windows as switchable tabs, and
agent-window targeting so greeter/RC/kickoff reach the agent's window rather than whatever tab is
focused. Slice 3 ("Add agent") was reshaped and never started. This change is that slice, plus the
cockpit design the second agent forces.

## What Changes

- **Add-an-agent, post-launch.** A pod may gain a second agent of a *different* type
  (`claude-code` + `codex`, at most one of each). The control plane appends to `pods.agents`,
  validates against the env's declared agents, and spawns the agent in its own tmux window
  (reusing the window primitive from slice 1). A second agent of the SAME type stays out of scope —
  two Claudes share `~/.claude` and `~/work` and would race.
- **Cockpit reorganized around connection state, not agent count.** The ready state answers one
  question first — *is remote control live?* — and only expands into per-agent detail on demand:
  - **Connected** (either agent, or both): a single calm "Remote control active" state naming which
    agents are connected. Not two competing panels.
  - **The Codex flow is progressive disclosure**: login + pairing live behind an explicit
    "Connect Codex" / "Pair another device" affordance that expands the existing wizard, instead of
    occupying the cockpit permanently.
  - **Claude keeps its one-click hand-off** (`Continue in Claude`) since it has one.
- **Codex RC session naming.** Investigated: `codex remote-control start` exposes no `--name`/
  `--title`; the binary reads `/proc/sys/kernel/hostname` for device identity, and a pod's hostname
  is already its slug (`cheerful-donkey-6bc4`). So the Codex app shows the pod slug today. Making
  the user's chosen pod NAME the visible identity means setting the pod's hostname to it (or the
  `-c` config override, if a key exists) — spec'd here as a requirement with the mechanism to be
  confirmed live, not asserted.

## Capabilities

### New Capabilities
- `multi-agent-pods`: adding a second, different agent to an existing pod, and how the cockpit
  presents one-or-two agents' connection state.

### Modified Capabilities
- `control-plane`: an owner-scoped add-agent action; `pods.agents` becomes append-able post-launch.
- `dashboard`: the cockpit ready-state is reorganized around RC connection state with the Codex
  flow behind progressive disclosure.
- `pod-boot`: spawning an added agent into its own window on an already-running pod, and the RC
  session identity (hostname/name) for Codex.

## Impact

- `packages/control-plane/src/service.ts` — add-agent action (owner-scoped, env-validated, idempotent).
- `packages/pod-agent` — spawn-agent-in-new-window on a live pod (slice 1's window primitive +
  slice 2's targeting already exist); Codex daemon start for a newly added Codex.
- `apps/web/components/pod-cockpit.tsx` + `codex-pair-panel.tsx` — the ready-state reorganization.
- No schema migration: `pods.agents` already exists and is nullable/jsonb.
- Ships as: web+gateway deploy for the control plane and cockpit; pod-agent changes need an image
  rebuild; the hostname/naming change needs a pod recreate to take effect.
