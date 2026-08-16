## 1. Boot command: enable + name

- [x] 1.1 `boot.ts`: `sanitizeSessionName(raw)` — strip single quotes/newlines, collapse
  whitespace, cap length (~60), fallback when empty
- [x] 1.2 `boot.ts`: thread `sessionName` through `agentInvocation` / `bootCommandForAgent` /
  `kickoffCommandForAgent`; claude invocations gain `--remote-control "<name>"` (both kickoff and
  plain branches); codex unchanged
- [x] 1.3 `main.ts`: read `envName` + `slug` from the pod-spec, build `"<envName>: <slug>"`, pass to
  the command builders
- [x] 1.4 `boot.test.ts`: flag present for claude (both branches), absent for codex, name sanitized
  (no single quotes → the `bash -lc '…'` wrapper stays valid), name appears once

## 2. Ship + verify

- [x] 2.1 build + pod-agent tests green (17); boot-command syntax check passes (incl. apostrophe name)
- [x] 2.2 verified `claude` **v2.1.209** exposes `--remote-control [name]` (+ `-n/--name`); pod-base
  rebuilt + pinned (`sha256:304f77b…`) on web + gateway
- [x] 2.3 **Live-debugged (pod panicky-hummingbird-ffef):** a POSITIONAL launch prompt (the kickoff
  trigger) SUPPRESSES remote control — `--remote-control` + `--append-system-prompt-file` alone
  activates it, adding `"Time to get started."` as an arg does not. Fix: launch prompt-free, poll the
  pane for `remote-control is active`, then `tmux send-keys` the trigger so the agent still speaks
  first. Verified in a diag session: RC activates + agent greets. Session-URL format:
  `https://claude.ai/code/session_<id>`.
- [x] 2.4 **Mechanism live-debugged to correctness:** (a) `--remote-control` LAUNCH flag →
  switched to typed `/remote-control <name>` once the pane quiesces (vels' idea; also warmer/less
  flaky than firing at cold-start); (b) `send-keys "text" Enter` in one burst = unsubmitted
  multi-line draft → split into type-then-separate-Enter (verified the draft now submits). Greeting
  decoupled so the agent always speaks first.
- [ ] 2.5 **BLOCKER — account tier:** RC did NOT activate on pods authed with **API Usage Billing**
  (header said "API Usage Billing", Claude showed "migrating from API-key access"); it DID work on a
  pod on **Claude Max**. **Remote Control is a Claude subscription feature — not available on
  API-key/usage billing.** The account likely fell back to API billing after exhausting its weekly
  subscription limit (aggravated by this session's heavy testing). Verify RC end-to-end once the
  account is back on subscription auth with headroom.
- [ ] 2.6 **Follow-up:** detect a pod's billing/auth mode and, when it's API-billing (no RC), don't
  promise the app hand-off — surface "remote control needs a Claude subscription" in the UI.
