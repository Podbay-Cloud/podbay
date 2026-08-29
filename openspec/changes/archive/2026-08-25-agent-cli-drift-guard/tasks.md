## 1. Golden-path integration test (the real-CLI gate)

- [x] 1.1 Add a reusable `runClaudeGoldenPath()` helper that: spawns real `claude` (throwaway `$HOME`),
      invokes the pod-agent's OWN onboarding seed + `driveLoginMenu` against it (not a bespoke driver),
      polls `extractLinks`, and returns `{ ok, url, pane }` — `ok` iff a URL with `redirect_uri` AND
      `state` is captured. Bound it with a timeout.
- [x] 1.2 Add a `runCodexGoldenPath()` helper: spawn real `codex login --device-auth`, drive to the
      device screen, assert a device URL + one-time code are produced and captured.
- [x] 1.3 Add `packages/pod-agent/test/golden-path.test.ts` using the `session.test.ts` real-tmux
      pattern, asserting both helpers pass. Guard with a `canRunRealCli()` check (tmux + binary present,
      PTY works) that SKIPS with a clear reason otherwise — never a spurious `posix_spawnp` fail.
- [x] 1.4 Run it on a pod (real tmux) and confirm it passes on the current pinned versions
      (claude 2.1.215 / codex 0.146.0), and that it FAILS if the theme-seed + theme-dismiss are removed
      (proves it would have caught this session's break).

## 2. Gate the pod-base image build on the golden path

- [x] 2.1 Add a `scripts/incus/golden-path-check.sh` that launches a throwaway instance from the
      just-built image, runs the golden path INSIDE it against the shipped CLI versions, prints the
      captured pane on failure, and exits non-zero on fail. Destroy the instance after.
- [x] 2.2 Wire it into `scripts/incus/build-and-record.sh` AFTER `build-image` and BEFORE
      `record-image.sh`/alias re-point: on failure, abort with the pane diagnostics and leave the alias
      on the last-good image. Add a `SKIP_GOLDEN_PATH=1` escape hatch (documented, for emergencies).
- [x] 2.3 Verify end-to-end: a build with a deliberately-broken drive fails the gate and does NOT
      record/promote; a healthy build passes and records as today.

## 3. Weekly CLI-drift canary (detect + alert; PR/issue gated on owner yes)

- [x] 3.1 Add `scripts/incus/cli-drift-canary.sh`: spin a scratch instance from pod-base, update
      claude/codex to `@latest` inside it, capture old→new versions, run the golden path, destroy the
      instance, emit a structured trailer (`CANARY_RESULT pass=.. claude_old/new=.. codex_old/new=..`).
      Detection-only — it makes no outward write.
- [x] 3.2 On PASS: the scheduled turn stages a LOCAL pin-bump branch (Dockerfile +
      provision-pod-base.sh) to the tested versions and reports it to the owner (delta + passing log).
      OPENING the PR is outbound → gated on the owner's in-chat yes (confirm-before-outbound rule); the
      canary never auto-opens/merges. [design changed from "auto-open PR on green" — see design.md]
- [x] 3.3 On FAIL: the scheduled turn alerts the owner (owner-scoped, allowed) with the captured pane +
      version diff; makes NO pin change and NO code change. Opening a GitHub issue is outbound → gated.
- [x] 3.4 Register it as a durable weekly job via `podbay schedule` (NOT `CronCreate`) — registered as
      `cli-drift-canary` @ 09:00 UTC, weekly-gated to Monday in the prompt; survives restarts.

## 4. Shrink the TUI-scraping surface (opportunistic)

- [x] 4.1 Audited the remaining TUI-drives. Findings: theme picker → config-driven via settings.json
      seed (done, the model). API-key prompt → env-conditional (only with ANTHROPIC_API_KEY set); no
      new config lever beyond env hygiene, drive-dismiss retained. Login-method menu → inherent to
      `/login`, no config lever, must be driven. Recorded in docs/runbooks/cli-pin-bump.md.
- [x] 4.2 Key-drive fallbacks retained for every prompt (theme + api-key dismissal already in
      `driveLoginMenu`), so an unexpected prompt is still handled belt-and-suspenders.

## 5. Docs + spec archive

- [x] 5.1 Added `docs/runbooks/cli-pin-bump.md`: the procedure — canary GREEN stages a pin-bump +
      reports (PR open gated) / RED alerts → review delta → the gated build re-validates → digest bump.
      STATES the automatable ceiling (up to the OAuth URL / device code; full sign-in owner-verified).
- [x] 5.2 On ship, `openspec archive agent-cli-drift-guard` and keep `tasks.md` honest.
