## Context

What already exists (so this change is smaller than it looks):
- `pods.agents` jsonb column (migration 0023) + launch picker + provider threading — the *selection*
  plumbing is done, it just never changes after launch.
- **Slice 1 (shipped, imaged):** tmux windows as switchable web tabs — `windows`/`select-window`
  protocol frames, tab strip shown when >1 window.
- **Slice 2 (built):** agent-window targeting — greeter, RC, login-menu, kickoff-respawn, scheduler
  all target `main:<agentWindow>` rather than whatever tab is focused. This is what makes a second
  agent safe: agent ops don't leak into the other agent's pane.
- Codex A1/A2: device-code login, standalone build seeded, `ensureCodexDaemon`, pairing-code minting
  (`remote-control pair --json`), and the cockpit pairing wizard with QR + owner-confirmed devices.

So the missing pieces are: an add-agent action, spawning into a window on a LIVE pod, and the
cockpit information architecture.

## Goals / Non-Goals

**Goals**
- Add a different-type agent to an existing pod without relaunching it.
- A cockpit that stays calm with two agents — RC state first, per-agent detail on demand.
- Answer the Codex RC naming question with a mechanism, not a guess.

**Non-Goals**
- A second agent of the SAME type (two Claudes share `~/.claude` + `~/work` → races). Out of v1.
- Concurrent agents working simultaneously on the same tree — the model stays **switching-first**
  (one shared `~/work`; two agents editing at once will conflict on files/git/:3000). Parallel
  isolation is worktrees or a separate pod, which is workstream B.
- Removing an agent (v1 is additive; removal invites "what happens to its session/credentials").

## Decisions

**1. Additive, different-type-only, at most one of each.** Enforced in the control plane, not just
the UI. The env's declared `agents` remains the outer bound — a pod can't gain an agent its env
never allowed.

**2. Spawn into a new tmux window on the live pod — do NOT recreate.** Slice 1 made windows
first-class and slice 2 made agent ops window-targeted, so adding an agent is "create window, launch
that agent's boot command in it, register it as that agent's window". No restart, so the running
agent's session survives — which matters because the alternative (recreate to change `agents`) would
kill the very session the user is adding a partner to.

**3. Cockpit IA: connection state first, agent detail on demand.** The ready state's job is to
answer *"can I reach my pod from my phone?"* — that's one question regardless of agent count.
- **One RC status block**, naming connected agents ("Remote control active · Claude, Codex").
- **Claude:** keep the direct `Continue in Claude` hand-off (it has a session URL).
- **Codex:** its login + pairing is a multi-step wizard, so it sits behind a **disclosure**
  ("Connect Codex", or "Pair another device" once connected) that expands the existing
  `CodexPairPanel` in place. Rationale: the wizard is *transactional* — needed intensely for 60
  seconds, then never until a new device. Permanently rendering it taxes every later visit.
- **Never two competing panels.** With both agents connected the cockpit shows ONE connected state;
  the per-agent affordances are secondary.

**4. Codex RC naming — investigated, mechanism identified.** `codex remote-control start` has no
`--name`/`--title` (only `-c key=value` config overrides and `--enable`). The RC binary reads
`/proc/sys/kernel/hostname`, and an Incus pod's hostname already equals its slug — so the Codex app
currently shows `cheerful-donkey-6bc4`. To show the user's chosen NAME instead, set the pod's
hostname to it (sanitized to a valid hostname) at boot/rename, or use a `-c` override if a config
key turns out to exist. **Spec'd as an outcome ("the app shows the pod's chosen name") with the
mechanism to be confirmed on a live paired device** — the strings evidence is suggestive, not proof,
and the honest move is to verify before claiming it works.

**5. Kickoff/greeting for an added agent.** The added agent boots into an existing workspace with
work already in progress, so it must NOT re-run the env's onboarding kickoff (which assumes a fresh
pod and would re-greet/re-ask). It gets the resume path instead — the same posture as a restarted
agent — plus, ideally, a pointer to the handoff note so it can orient on what the other agent has
been doing. This is where the existing `handoff` skill pays off across agents rather than just
across restarts.

## Risks / Trade-offs

- **Shared workspace races.** Two agents, one `~/work`, one `:3000`. Switching-first is the stated
  model, but nothing *prevents* a user driving both. Mitigation: state it plainly in the UI when the
  second agent is added, and let the handoff/PLAN.md conventions carry context between them. A hard
  lock is out of scope and probably wrong.
- **Cockpit complexity is the real risk, not the backend.** The add-agent action is small; the UI is
  where this can go wrong. Progressive disclosure is the bet — if it makes Codex pairing feel
  *hidden* rather than *tidy*, revisit (the failure mode to watch: users not finding "Pair another
  device").
- **Codex is still second-class in places** (permission model differs, literacy lands in AGENTS.md
  not CLAUDE.md, skills need translation). Adding Codex to a Claude pod inherits those gaps — this
  change doesn't close them, and shouldn't pretend to.
- **Naming may not be settable at all.** If hostname isn't what the app displays, the honest outcome
  is "the Codex app shows the pod slug; we can't rename it yet" — a documented limitation rather
  than a hack.
