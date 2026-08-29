## ADDED Requirements

### Requirement: The image ships only a CLI version whose real sign-in golden path passes

The pod-base image build SHALL validate the agent CLI versions it will ship against a REAL-CLI "golden
path" — booting the actual `claude`/`codex` binary and running the pod-agent's own onboarding and
login-drive against it — and SHALL REFUSE to record or promote the image (leaving the `pod-base` alias
on the last-good image) if the golden path fails. The golden path SHALL assert only what is
automatable without credentials: a COMPLETE sign-in artifact is produced and captured. It is
explicitly NOT required to complete the browser OAuth; the full authed sign-in remains an
owner-verified check.

The golden path SHALL exercise the pod-agent's PRODUCTION drive/capture code (not a bespoke test
driver), so it fails exactly when the shipped code would fail. Where a real tmux or the CLI binary is
unavailable (a no-TTY sandbox), the check SHALL SKIP with a clear reason rather than fail spuriously;
the build-time gate runs where the binary and tmux are real.

#### Scenario: A CLI whose onboarding/menu drift breaks sign-in fails the build

- **GIVEN** a pod-base build whose pinned `claude` (or `codex`) version has changed its onboarding or
  login TUI such that the pod-agent no longer reaches a complete OAuth URL / device code
- **WHEN** the build runs the golden path against that version before recording the image
- **THEN** the build SHALL fail with the captured pane as diagnostics, the image SHALL NOT be recorded
  or promoted, and the `pod-base` alias SHALL remain on the last-good image

#### Scenario: The golden path validates up to the sign-in artifact, not the full OAuth

- **WHEN** the golden path runs against a healthy CLI version
- **THEN** it SHALL assert that a COMPLETE Claude OAuth URL (containing both `redirect_uri` and
  `state`) is produced and recovered by the pod-agent's link capture, and that Codex's device-auth URL
  plus one-time code are produced and captured
- **AND** it SHALL NOT attempt to complete the browser OAuth (no credentials in CI); the full authed
  sign-in and create-pod-to-ready flows remain owner-verified

#### Scenario: The check skips, not fails, where the real CLI cannot run

- **WHEN** the golden path runs in an environment without a usable tmux/PTY or without the CLI binary
- **THEN** it SHALL skip with a clear reason and SHALL NOT report a spurious failure

### Requirement: A scheduled canary detects upstream CLI drift and alerts without auto-fixing

A durable scheduled job SHALL periodically run the golden path against the LATEST upstream
`claude`/`codex` in a throwaway scratch pod, and SHALL react to the outcome by DETECTING and ALERTING
— never by auto-fixing, and never by publishing outward without the owner's confirmation:

- On PASS, it SHALL stage the pin bump locally (a branch/commit updating the image's CLI pins to the
  exact tested versions) and MESSAGE the owner's own pod (owner-scoped, not an outward publish) that
  the bump is safe and staged. OPENING the pull request is an outbound action and SHALL require the
  owner's explicit confirmation — it SHALL NOT be auto-opened.
- On FAIL, it SHALL MESSAGE the owner's own pod with the captured pane and the old→new version diff,
  and SHALL NOT change the pins. Opening a public tracking issue is likewise outbound and SHALL wait
  on the owner's confirmation.

The job SHALL be durable (surviving restarts) rather than an in-memory schedule, and SHALL destroy the
scratch pod after the run. It SHALL NEVER apply an unsupervised fix for a detected break, and SHALL
NEVER make an outbound write (PR, issue, or any published artifact) without the owner's in-chat yes —
the owner-scoped pod message is the automated channel; the PR/issue is gated.

#### Scenario: A safe upstream version is staged and surfaced for a gated PR

- **WHEN** the canary runs the golden path against `@latest` and it PASSES
- **THEN** it SHALL stage a local pin-bump to those exact `@latest` versions and message the owner's
  pod that it is safe + staged, and SHALL NOT open or merge the PR without the owner's confirmation

#### Scenario: An upstream break alerts the owner rather than shipping or self-fixing

- **WHEN** the canary runs the golden path against `@latest` and it FAILS
- **THEN** it SHALL message the owner's pod with the captured pane and the version diff, SHALL NOT bump
  the pins, SHALL NOT attempt any automated code fix, and SHALL NOT publish an outbound issue without
  the owner's confirmation
