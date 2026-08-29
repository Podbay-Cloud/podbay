## Context

The sign-in flow drives the Claude/Codex CLI's interactive TUI (login-menu, API-key prompt, theme
picker) and scrapes the OAuth URL from the pane. Grounding facts from the code:

- CLIs are PINNED in the image: `packages/provider/pod-base/Dockerfile:229` and
  `scripts/incus/provision-pod-base.sh:104` install `@anthropic-ai/claude-code@2.1.215
  @openai/codex@0.146.0`. Auto-update is OFF (`Dockerfile:125 DISABLE_AUTOUPDATER=1`), so a pod's
  version == the image's pin. `podbay agent update` (in `packages/provider/pod-base/podbay`) is a
  manual, opt-in per-pod update to `@latest`.
- The TUI-driving lives in `packages/pod-agent/src/greeter.ts` (`driveLoginMenu`: waits for
  `LOGIN_MENU_RE`, dismisses `API_KEY_PROMPT_RE` and now `THEME_PROMPT_RE`) and the capture in
  `packages/pod-agent/src/signals.ts` (`extractLinks` + `isCompleteAuthUrl`).
- The real-tmux + real-binary test pattern already exists: `packages/pod-agent/test/session.test.ts`
  (spawns a `PtySession`, drives tmux, asserts on `extractLinks`). It RUNS in this environment
  (node-pty + tmux work on a pod); the `posix_spawnp` failures are the sandbox-without-a-TTY case.
- The image build entry point is `scripts/incus/build-and-record.sh` (rsync → box `make-payload` →
  `build-image` → `record-image.sh`); it re-points the `pod-base` alias, so a bad record ships.
- Existing e2e (`apps/web/e2e/*`) is fake-stack only (`FakeProvider`, injected `authUrl`) — it cannot
  exercise the real CLI TUI, which is the fragile surface.

## Goals / Non-Goals

**Goals:**
- Catch a CLI TUI-drift break (a version whose onboarding/menu changes stop the pod-agent producing a
  complete OAuth URL) BEFORE it reaches a pod — as a gate on the image build.
- Detect proactively when the next upstream `@latest` would break us, and turn a safe bump into a
  reviewable PR.
- Do it with the real binary + real tmux (the only layer that sees TUI drift), skipping cleanly where
  that isn't available.

**Non-Goals:**
- Completing the browser OAuth in CI (no creds) — the automatable ceiling is "a complete URL/device
  code is produced and captured". Full authed sign-in / create-pod-to-ready stay owner-verified.
- Unsupervised auto-FIXING of a detected break. Auto-PR fires ONLY on a passing canary; a failure
  alerts a human with diagnostics.
- Re-testing the fake-stack UI flows (already covered) — this is specifically the real-CLI layer.

## Decisions

**1. The golden path is a real-tmux integration test, not a web e2e.** Extend
`packages/pod-agent/test/session.test.ts` (or a sibling `golden-path.test.ts`): spawn the real
`claude` with a throwaway `$HOME`, run the pod-agent's OWN onboarding/login-drive against it (so the
test exercises `driveLoginMenu` + the boot theme-seed, not a bespoke driver), and assert `extractLinks`
returns a URL with `redirect_uri` AND `state`. Reusing the pod-agent's own drive is the point: the test
fails exactly when the code that runs in production fails.

**2. Skip, don't fail, when the environment can't run it.** Guard on tmux + the binary being present
(and node-pty working). In a no-TTY sandbox the test SKIPS with a clear reason — never a red herring
`posix_spawnp`. The BUILD gate runs on the box (real tmux/binary), where it does execute.

**3. Gate the build in `build-and-record.sh`, before `record-image.sh`.** After `build-image`
produces the image, launch a throwaway instance from it, run the golden path INSIDE it against the
CLI versions the image actually ships, and only `record` + re-point the alias if it passes. A failure
prints the captured pane and aborts with a non-zero exit — the alias stays on the last-good image.
(Reuses the scratch-pod recipe in `docs/runbooks/agent-ops-access.md`.)

**4. The canary is a `podbay schedule` job, weekly.** It: (a) spins a scratch pod, (b) `podbay agent
update claude`/`codex` to `@latest` in it, (c) runs the golden path, (d) branches:
- GREEN → open a PR that bumps the two pins in `Dockerfile` + `provision-pod-base.sh` to the tested
  `@latest` versions, PR body carrying old→new versions and the passing golden-path log. A human merges.
- RED → open a GitHub issue AND `podbay msg` the owner's pod with the captured pane + `claude
  --version`/`codex --version` old→new + the failing assertion. NO pin change.
Then destroy the scratch pod. The schedule is durable (`podbay schedule`), not `CronCreate`.

**5. Shrink the TUI surface where the CLI offers config.** The theme seed (writing
`~/.claude/settings.json`) is the template: prefer a config write over a TUI key-drive. Audit the
remaining drives (API-key prompt, method menu) for a config/env alternative; convert opportunistically.
The golden path guards whatever remains (the OAuth URL is irreducibly CLI-produced).

**6. Alert channel: GitHub issue for the record, `podbay msg` for immediacy.** The issue is the
durable tracker; the pod message wakes the owner's agent with the diagnostics so it surfaces in chat.

## Risks / Trade-offs

- **The golden path can't complete OAuth**, so a break AFTER the URL (e.g. the paste-code step) isn't
  caught — accepted; that stays owner-verified, and "produce a complete URL" catches the historical
  break class.
- **Real-binary tests are slower + need the binary present.** Mitigated by skip-guards and by running
  the hard gate on the box (build time), not on every unit run.
- **The canary consumes a scratch pod + `@latest` download weekly.** Cheap, and it destroys the pod
  after; the schedule is opt-outable.
- **`@latest` is a moving target** — a canary PASS is only valid for the version it tested; the PR
  records the exact versions so the merge pins them, not a floating `@latest`.
- **False confidence:** a passing golden path doesn't prove the full sign-in works (only up to the
  URL). The runbook must state the automatable ceiling so nobody treats green as "sign-in verified".
- **CI-vs-box divergence:** if we ever run the gate in GitHub CI instead of the box, node-pty/tmux
  availability differs — keep the gate on the box where the image is actually built.

## Decisions taken during implementation (differ from the proposal above)

- **The canary does NOT auto-open a PR/issue (revised from decisions 4 + 6).** Opening a PR or a
  GitHub issue is an OUTBOUND write, gated by the confirm-before-outbound rule — the automation may not
  self-authorize it. So the canary is **detection-only** (`cli-drift-canary.sh` emits a `CANARY_RESULT`
  trailer, no writes); the durable scheduled turn does the reacting: on GREEN it stages a LOCAL
  pin-bump branch and reports to the owner (asking to open the PR); on RED it alerts the owner with the
  pane + version diff. The owner-scoped report is the automated channel; the PR/issue open waits on the
  owner's in-chat yes. The build gate already blocks a bad bump from shipping, so no auto-fix is lost.
- **The in-image probe covers BOTH claude and codex.** `golden-path-probe.mjs` (used by the build gate
  AND the canary) drives `claude /login` and `codex login --device-auth`, requiring a complete artifact
  from each (scope with `PROBE_CLI`). An earlier draft was claude-only, which would have left codex
  drift uncaught by the very gate meant to guard it.
- **TUI audit result:** theme picker is the only onboarding prompt with a clean config lever (seeded);
  the API-key prompt is env-conditional (avoid exporting `ANTHROPIC_API_KEY` into the sign-in shell,
  drive-dismiss retained); the login-method menu is inherent to `/login` and must be driven. Recorded
  in `docs/runbooks/cli-pin-bump.md`.
