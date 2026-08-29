## Why

Remote control currently becomes unreliable at the exact moments Podbay promises continuity: login
renewal, process crashes, Suspend, and image Update. The cockpit then compounds provider failures with
misleading or coercive recovery UI: a blocked Claude OAuth dialog can be reported as signed-in plus
RC-down, while an empty self-reported Codex device list can repeatedly force-open a pairing wizard.
Podbay is pinned to Claude Code 2.1.215 while upstream has since changed interactive reconnect
behavior, so the next fix must establish the current CLI's real behavior and then harden the shared
state and user recovery paths rather than committing to an unsupported daemon architecture.

## What Changes

- Keep the official interactive Claude Code TUI as Podbay's working-session architecture; do not
  migrate working sessions to `claude remote-control` server mode.
- Add an authenticated, real-test-pod Remote Control lifecycle matrix for the exact Claude Code
  version proposed for the image pin, covering graceful exit, crash, Suspend/wake, image Update, and
  pod-agent-only restart.
- Update the Claude Code pin deliberately after its existing sign-in golden path and the new RC
  lifecycle matrix pass, recording the exact version and observed reconnect outcomes.
- Model restart recovery explicitly as one of: existing RC session reattached, replacement RC session
  created, RC unavailable but locally recoverable, or login requiring owner action.
- Preserve a user-supplied session title when the same RC session survives; apply the pod title only
  when Podbay can establish that a fresh or replacement RC session was created. Remove the inaccurate
  assumption that Suspend always preserves the process.
- Make RC health and `podbay doctor` reflect current, evidence-backed state rather than a captured URL,
  and let `doctor --fix` perform only a bounded, conversation-preserving RC recovery when the login is
  still valid.
- Classify a blocking login/OAuth failure as `login-required` even when a credential file still looks
  valid, and prevent automatic or manual RC restore from typing into that blocked dialog.
- Give the Control tab an actionable, state-specific Claude recovery surface: bounded Restore Remote
  Control for a valid login with RC down, Reconnect for login-required, and honest progress/failure.
- Make Codex pairing explicit and non-coercive. Never infer that the cockpit may auto-open from an
  empty remembered-device list; after “I've paired this,” close the full-page wizard, refresh the
  device pills, and keep action errors visible instead of clearing the form as if it succeeded.
- Add fake-stack e2e coverage for Podbay's orchestration and UI across the modeled outcomes, while
  reserving claims about Anthropic session identity and app reconnection for the real-pod matrix.

## Non-goals

- Replacing the interactive TUI with Claude's headless Remote Control server, Agent SDK, or an
  undocumented session-injection API.
- Automating the human `/login` step or bypassing the subscription's hard login expiry.
- Making `bridge-pointer.json`, debug-log strings, or other undocumented Claude internals a durable
  product dependency.
- Adding Telegram, Discord, or another fallback control surface.
- Changing the Codex daemon, pairing protocol, or OpenAI-side device enrollment behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pod-boot`: Define version-aware interactive RC recovery and session-title ownership across real
  cold boots, Suspend/wake, Update, and component-only restarts.
- `pod-agent`: Report honest RC lifecycle state and provide bounded doctor diagnosis/recovery without
  modifying credentials or losing the local conversation.
- `agent-cli-golden-path`: Extend CLI pin validation with an authenticated real-pod RC lifecycle
  acceptance matrix that complements, rather than overclaims from, the unauthenticated sign-in canary.
- `dashboard`: Present actionable Claude RC recovery and make Codex pairing an explicit flow whose
  completion, cancellation, and errors return predictable cockpit state.
- `uix-e2e-tests`: Cover Podbay's simulated reconnect/replacement/failure orchestration while keeping
  the external broker reconnect assertion in the real-pod acceptance check, and cover the reported
  pairing completion/reload regressions.

## Impact

- **Code:** Claude launch/greeter/restart handling and health/doctor logic in `packages/pod-agent`;
  Control-tab state and Codex pairing completion in `apps/web`; pod-base CLI pins and their release
  checks; fake provider/session behavior and Playwright coverage.
- **Specs:** `pod-boot`, `pod-agent`, `agent-cli-golden-path`, `dashboard`, and `uix-e2e-tests`.
- **Operations:** a designated test pod is temporarily updated to the candidate Claude CLI and driven
  through destructive-to-process but non-destructive-to-workspace restart cases; the image is not
  promoted until the matrix passes.
- **ToS-sensitive surface:** the change continues to use the unmodified official Claude Code CLI,
  the owner's own subscription login, and documented interactive Remote Control interfaces. It does
  not proxy model authentication, capture credentials, or rely on a private session API.
