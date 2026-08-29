## Why

Podbay's sign-in and onboarding flow works by **scraping and driving the Claude/Codex CLI's
interactive TUI** — waiting for the "Select login method" menu, dismissing the API-key prompt,
rejoining the OAuth URL the TUI paints across rows. That TUI has **no stability contract** and changes
across CLI versions. The CLIs are pinned in the pod-base image (`@anthropic-ai/claude-code@2.1.215`,
`@openai/codex@0.146.0`) with auto-update OFF on pods, so versions change only when the pin is bumped —
but **nothing validates the flow against the new version before it ships**. When the pin reached
2.1.215, claude added a first-run "theme picker" that appears BEFORE the login menu; it blocked
`/login` so no OAuth URL was ever produced, and the sign-in wizard hung on "Getting the sign-in link…".
We found out only when the owner hit it on a live pod — because **every existing e2e runs on the fake
stack** (`FakeProvider` + an injected `authUrl`) and never exercises the real CLI TUI, so it went green
straight through the break. This is at least the fourth TUI-drift break in this flow's history
(login-menu wording, API-key prompt, URL wrapping, now the theme screen).

We need a test that exercises the REAL CLI up to the sign-in URL, gated on the image build, plus a
canary that tells us when the next `@latest` would break us — so a CLI bump can never silently ship a
broken sign-in again.

## What Changes

- **A real-CLI "golden path" integration test.** Extend the existing real-tmux + real-binary pattern
  (`packages/pod-agent/test/session.test.ts`): boot the ACTUAL `claude`, let the pod-agent's own
  onboarding/login-drive handle every pre-login prompt (theme picker, API-key prompt, method menu),
  and assert a **complete** OAuth URL (`redirect_uri` AND `state`) is produced AND recovered by
  `extractLinks`. A codex device-auth equivalent asserts the device URL + one-time code are produced
  and captured. **Ceiling (explicit):** automatable only UP TO the URL/code — CI cannot complete the
  browser OAuth (no creds), so the full authed sign-in / create-pod-to-ready stays an owner-verified
  check. The test SKIPS gracefully where a real tmux/binary is unavailable (the `posix_spawnp`
  sandbox caveat) rather than failing spuriously.
- **Gate the pod-base image build on it.** `scripts/incus/build-and-record.sh` runs the golden path
  against the CLI versions the image will ship and REFUSES to record/promote the image if it fails —
  so a pin bump that breaks the TUI-driving is caught before any pod boots it.
- **A weekly CLI-drift canary** (`podbay schedule`): run the golden path against `@latest`
  claude/codex in a throwaway scratch pod. GREEN → open a PR bumping the image pin (a known-safe
  bump, with the versions in the PR body). RED → open a GitHub issue AND message the owner's pod
  (`podbay msg`) with the captured pane + the version diff, and DO NOT bump. **Non-goal:** no
  unsupervised auto-FIX of a detected break — auto-PR fires only on a passing run; a failure alerts.
- **Shrink the TUI-scraping surface, opportunistically.** Prefer non-interactive config over
  TUI-driving where the CLI allows it (the theme seed in `~/.claude/settings.json` this session is the
  model). Fewer TUI-drives = fewer things a version bump can break.

## Capabilities

### New Capabilities
- `agent-cli-golden-path`: the pod-base image ships an agent CLI version only after its REAL sign-in
  golden path (onboarding auto-handled → login menu driven → a complete OAuth URL / device code
  produced and captured) is validated; a scheduled canary detects when the next upstream version would
  break the flow and alerts (never auto-fixes) rather than letting it ship.

### Modified Capabilities
_None._ The pod-agent onboarding requirement already states a first-run onboarding prompt must not
block launch/sign-in (config-seed + login-drive), added with this session's theme-picker fix
(`openspec/specs/pod-agent/spec.md` → "A first-run onboarding prompt never blocks launch or sign-in").
The opportunistic config-drive work here is implementation under that existing requirement, not a new
behavior — so no spec delta.

## Impact

- **New test:** a real-CLI golden-path integration test (pod-agent test suite / a dedicated
  integration target), designed to skip in no-tmux/no-binary environments.
- **`scripts/incus/build-and-record.sh`** (+ `make-payload`/`build-image` helpers): a pre-record gate
  that runs the golden path against the to-be-shipped CLI versions.
- **New scheduled job** (`podbay schedule`) + a scratch-pod runner for the canary; a GitHub issue/PR
  path and a `podbay msg` alert to the owner's pod.
- **`packages/pod-agent/src/boot.ts` / `greeter.ts`:** any additional config-seeds that replace a
  TUI-drive (opportunistic).
- **Docs:** the CLI-pin-bump procedure (canary → review → gated build) in `docs/runbooks`.
- No change to the running sign-in behavior itself — this is a guard around it.
