## Why

The app-primary pivot ([docs/entry-points-plan.md](../../../docs/entry-points-plan.md)) needs the
pod's Claude session to (a) be **remote-controllable** from the user's Claude apps and (b) carry a
**descriptive name** so it's findable in the app's session list. Today the pod boots
`claude … "Time to get started."` with no remote-control flag, so the session (if it registers at
all) shows a generic auto-name (`hostname-slug`) — the user reported seeing a generic "Claude
session".

Verified from Claude Code's Remote Control docs (2026): `claude --remote-control "<name>"` both
**enables** remote control and **sets the session title** (priority: explicit name > auto
`hostname-slug` > first-prompt-derived). So enablement + naming are one flag — workstreams 1 and 4
of the entry-points plan collapse into this change.

## Decisions

- **Enable + name at boot via `--remote-control "<name>"`** on the `claude` invocation (both the
  login→kickoff respawn and the plain/authed paths). Claude only — codex has no equivalent (leave
  as-is; verify codex parity separately).
- **Session name = `"<envName>: <slug>"`** read from the pod-spec (`envName`, `slug` already
  present). Correlates 1:1 with the dashboard's pod identity. Sanitized (no single quotes — the whole
  boot command is wrapped in `bash -lc '…'`; length-capped). Using the user's display name instead
  is a later enhancement (needs threading the name into the pod-spec).
- **Scope:** this change is boot-time enable + name only. Capturing the emitted session URL and
  re-running on wake are the sibling follow-up (entry-points workstream 1 remainder).

## What Changes

- **pod-agent `boot.ts`**: `agentInvocation` / `bootCommandForAgent` / `kickoffCommandForAgent` take
  a `sessionName`; claude invocations gain `--remote-control "<name>"`. Name sanitizer. Unit tests
  (flag present for claude, absent for codex, no single quotes, both branches).
- **pod-agent `main.ts`**: read `envName` + `slug` from the pod-spec, build the session name, pass
  it to the boot/kickoff command builders.
- **pod-base image**: rebuilt so pods boot with the new agent; live-verify the flag is accepted by
  the pinned claude version and the named session appears in the app.

## Risks / verify on real infra

- **Unknown-flag risk:** if the pinned `claude` version doesn't support `--remote-control`, boot
  breaks. Gate rollout on a live check (`claude --help` in the pod-base image / a test pod) BEFORE
  broad use; only new pods get the new agent, so blast radius is a test pod.
- **Does the named session actually appear + control cleanly** in the user's apps (user-confirmed),
  and does remote-control re-establish on wake (flaky per claude-code#55406 — the sibling change).
