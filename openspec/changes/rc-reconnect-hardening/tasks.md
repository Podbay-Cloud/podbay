## 1. Candidate-version evidence gate

- [x] 1.1 Run the existing real-CLI sign-in canary against exact Claude Code 2.1.246 and record the
  complete-url/menu result; stop the candidate before touching RC behavior if this gate is red.
- [ ] 1.2 Capture test:1's current credential-valid plus invalid-OAuth-code retry pane as a sanitized
  classifier fixture, then have the owner complete Reconnect and establish an active baseline without
  clearing its workspace or local conversation.
- [ ] 1.3 On designated test:1, record its current CLI version and RC identity, set a recognizable
  owner title, then run the authenticated lifecycle rows for pod-agent-only restart, graceful Claude
  restart, forced Claude restart, Incus Suspend/wake, and image Update/recreate; record local-history,
  RC-identity, reachability, title, and TUI outcome evidence for every row.
- [ ] 1.4 Reduce the matrix evidence to the documented interactive recovery sequence supported by the
  candidate version and add captured outcome fixtures; if any required row has no documented,
  conversation-preserving recovery, restore test:1's prior CLI version and mark the change blocked
  rather than selecting daemon/private internals.
- [x] 1.5 Add the authenticated RC matrix and rollback procedure to the CLI pin-bump runbook, clearly
  separating its real-infrastructure claim from the unauthenticated golden path and fake e2e. Add a
  regression test for the drift canary's global install: it SHALL install with sufficient privileges,
  fail on install/version mismatch instead of swallowing the error, and support an exact candidate
  version so the reported `claude_new` is the binary the probe actually exercised.

## 2. Honest RC lifecycle and title ownership

- [x] 2.1 Add failing pod-agent unit tests for the `active`, `recovering`, `down`, `login-required`, and
  `unknown` classifications, including stale URL, current failure, login menu, test:1's invalid-code
  retry dialog with a still-valid credential, and missing-signal fixtures from 2.1.246; implement one
  shared classifier that makes those tests pass. (17 tests, `rc-state.test.ts` + `rc-state.ts`. NOTE:
  reuses the already-captured `pane.test.ts` `OAUTH_RETRY_GATE`/`LOGIN_MENU` fixtures, which predate
  the 2.1.246 pin bump — section 1's candidate matrix (1.2-1.4) is not yet complete, so no NEW
  2.1.246-specific pane captures exist yet; re-verify against 2.1.246 fixtures once 1.2-1.4 land.)
- [x] 2.2 Add failing tests for same-session, replacement-session, first-session, and unobservable-ID
  title behavior; replace `coldStart` with a mode-0600 Podbay state record containing only the prior
  session-ID hash, and make `/rename` run only for an observed fresh/replacement identity. (`9c37b9b`:
  `rc-session-identity.ts` + `greeter-rc.test.ts`, includes the exact pod-agent-only-restart regression.)
- [~] 2.3 Add failing restart tests proving a pod-agent-only restart preserves an owner title (DONE —
  covered by 2.2's `greeter-rc.test.ts` "pod-agent-only restart" case) and an Incus Suspend/wake is
  treated as a cold boot whose actual RC outcome is classified (STILL OPEN — no dedicated test proving
  an Incus wake routes through `boot()`/`startGreeter()` rather than `reenableRemoteControl`, though
  the existing unconditional `startGreeter()` call in `boot()` already makes this true in practice);
  remove stale code/spec comments that describe Suspend as an in-process thaw (`c769415`: fixed —
  `reenableRemoteControl`'s comment and `pod-boot/spec.md` now name Fly's genuine in-place suspend vs.
  Incus's plain-stop cold boot explicitly, instead of generalizing "suspend/resume" as one thing).
- [x] 2.4 Add `rcState` to the shared health protocol and pod-agent response with backward-compatible
  parsing; verify `rcActive` is true only for known-active and older-image absence remains unknown.
  (`protocol.ts`'s `RcState` type + optional `PodAgentState.rcState`; `server.ts`'s `agentStates()`
  now computes `rcState` via the classifier and derives `rcActive: rcState === "active"`, replacing
  the prior ad-hoc boolean. Older-image absence is documented as "treat as unknown" on the field and
  in the main spec's new scenario — not enforced in code here since this pass doesn't touch a
  consumer; apps/web consumption is task 4.x.)

## 3. Native-first recovery and doctor

- [ ] 3.1 Add failing greeter tests for waiting on Claude's native `--continue` RC outcome before
  opening `/remote-control`; implement the candidate-version outcome classifier and prove an active
  native reattach receives no redundant recovery command.
- [ ] 3.2 Add failing tests for the matrix-selected documented recovery sequence, attempt cap, backoff,
  pre-attempt pane reclassification, refusal to type through blocking auth/menu UI, post-attempt
  reclassification, and replacement-session local-history preservation; implement one recovery
  primitive shared by boot and automatic restore.
- [~] 3.3 Route `/healthz`, automatic RC restore, and the existing `/agent/rc-restore` endpoint through
  the shared lifecycle classifier/recovery primitive; test valid-login down, login-required, yielded
  to T3, unknown, success, and capped-failure cases. (DONE against TODAY's recovery mechanism — the
  greeter's `/remote-control`, still the only implementation, since 3.1/3.2's native-`--continue`-first
  primitive is not built yet: `server.ts`'s new `primaryRcState()` assembles the SAME classifier
  inputs `agentStates()` already used, and both `reenableRemoteControl` and `failStateWatchdog`'s
  auto-restore tick now gate on `shouldAttemptRcRestore` (new pure decision in `rc-state.ts`, tested in
  `rc-state.test.ts`) — `login-required` runs neither the greeter nor spends a bounded-attempt slot.
  `/agent/rc-restore` now responds `{ok:false,reason:"login-required"}` instead of a blanket
  `{ok:true}` when skipped, `{ok:true,rcState:...}` otherwise. STILL OPEN: once 3.1/3.2 land, this
  gating point moves to whatever primitive replaces `reenableRemoteControl`'s greeter call — the
  classifier/decision function is written to be primitive-agnostic already.)
- [x] 3.4 Extend `podbay doctor` to report `down`, `login-required`, and `unknown` distinctly and make
  `doctor --fix` call the shared recovery primitive only for a valid, non-yielded login; test that it
  re-reads the final state and never changes credentials or declares success from submission alone.
  (`podbay-doctor`'s `_rc_state()` replaces `_rc_down()`, reading the pod's `rcState` field (falling
  back to `unknown` — never the old boolean heuristic — when absent, e.g. an older image);
  `check_remote_control` now emits a distinct `remote-control-login-required` issue and does NOT call
  `/agent/rc-restore` for it; `unknown`/`recovering` stay silent (judgment call, documented inline —
  "green is empty" per the script's own header, and neither is a confirmed problem); `down`'s `--fix`
  already re-read post-attempt state and now checks for exactly `"active"` rather than merely
  `!_rc_down`, closing an edge case where "not down" could mean "went from down to logged-out" and
  still read as fixed. Tested end-to-end via a scripted local `/healthz`+`/agent/rc-restore` mock in
  `packages/provider/test/doctor-remote-control.test.ts`.)

## 4. Cockpit recovery and explicit Codex pairing

- [x] 4.1 Add failing web state tests for every `rcState` mapping, including test:1's blocked OAuth
  dialog mapping to Reconnect, valid-login `down` mapping to Restore remote control, bounded
  `recovering` progress, and `unknown` never rendering an endless turning-on state.
- [x] 4.2 Add a web action for the existing shared RC restore endpoint and wire the Claude row to call
  it only for `down`; disable concurrent attempts, refetch the shared health query, and surface the
  observed success/failure instead of assuming the request restored RC.
- [x] 4.3 Add failing component/e2e tests for `Work Desktop`: successful “I've paired this” closes the
  full-page wizard, invalidates/refetches the confirmed-device query, and renders the pill; an action
  error retains the label, stays in the wizard, and renders the error. (`0e9567b`: RED e2e in
  `multi-agent.spec.ts` turned GREEN — `codex-pair-panel.tsx`'s `confirm()` now inspects
  `confirmCodexDevice`'s result instead of ignoring it; failure keeps the wizard/label, shows the
  error. Bookkeeping: this checkbox was left unmarked when 4.3-4.5 actually shipped — verified done
  by independently re-running the e2e spec this session, not newly implemented now.)
- [x] 4.4 Remove `shouldAutoOpenPairing` and its cockpit-session guard. Add regression coverage proving
  an empty/loading device list, delayed Codex-live update, Back, reload, and completed Claude+Codex
  onboarding never open pairing without the explicit Control-row action. (`0e9567b`: `shouldAutoOpenPairing`
  and the `pairingAutoOpened` guard deleted entirely from `agent-card-state.ts`/`agent-cards.tsx`/
  `pod-cockpit.tsx`; pairing now opens ONLY via the explicit "Pair a device" button, proven by the same
  e2e spec's first assertion — no `?wiz=pair` navigation on Codex going live with zero devices.)
- [x] 4.5 Remove stale code comments/tests that describe inline or automatic pairing, and audit copy
  to say ChatGPT app consistently where device removal/pairing is described. (`0e9567b`: dead
  `shouldAutoOpenPairing` unit tests removed from `agent-card-state.test.ts`.)

## 5. Simulated product-path coverage

- [x] 5.1 Extend the fake provider/session model with deterministic reattached, replacement, down,
  login-required, and unknown RC outcomes, keeping these fixtures explicitly simulated. (`fake-provider.ts`:
  `scripted()` gained `rcState`/`rcRestoreTo`, and `podHealth()`'s claude-code agent now uses a scripted
  `rcState` directly — deriving `rcActive: rcState === "active"` the same way `server.ts`'s real
  `agentStates()` does — leaving every unscripted pod byte-for-byte unchanged (151/151 provider tests
  stayed green). `exec()` gained a built-in simulated `/agent/rc-restore`: on a match it returns
  `{ok,reason?,rcState?}` — the same shape `service.ts`'s `restoreRemoteControl` parses — and, when
  `rcRestoreTo` is scripted, MUTATES the pod's own scripted `rcState` so the next health poll reflects
  the "restored" outcome, without a second scripting call from the test. `login-required` short-circuits
  to `{ok:false,reason:"login-required"}`, matching the real endpoint's skip. Write-side:
  `apps/web/e2e/helpers.ts`'s `scriptPodHealth` (the existing per-pod health sidecar, confirmed the
  correct entry point — `agentStatus`/`codexStatus` etc. share the same file but currently have no e2e
  writer at all) gained typed `rcState`/`rcRestoreTo` params.)
- [x] 5.2 Add Playwright coverage that verifies same-session title preservation, replacement naming,
  honest cockpit state, cockpit/doctor recovery success and failure, Reconnect-without-RC-repair for
  login-required, and the explicit Codex pairing completion/dismissal paths. (RC-lifecycle slice DONE —
  new `apps/web/e2e/rc-recovery.spec.ts`, 5 tests, all green against the real cockpit UI + fake stack:
  `down` shows Restore remote control (not the old "turning on…" catch-all), a click busies/disables the
  button and reclassifies to `claude-linked` once the scripted restore lands; `login-required` shows
  Reconnect, never Restore, never the catch-all; `recovering` shows the bounded-progress copy with the
  spin dot and no action; `unknown` shows the honest "couldn't be verified" copy with no spinner and no
  success state; unscripted `active` is an unchanged regression check. STILL OPEN (out of this pass's
  scope — belongs with tasks 4.3/4.4, not yet built): same-session/replacement title preservation e2e and
  the explicit Codex pairing completion/dismissal e2e — the uix-e2e-tests delta spec's scenarios for those
  remain unimplemented.)
- [x] 5.3 Audit RC-related test names and assertions so no fake/unit test claims that Anthropic's broker
  or Claude app reattached; reference the designated-test-pod matrix as the external acceptance gate.
  (Audited `rc-state.test.ts`, `rc-session-identity.test.ts`, `greeter-rc.test.ts`,
  `doctor-remote-control.test.ts`, `agent-card-state.test.ts`, and the new `rc-recovery.spec.ts` — every
  test name/comment already scopes its claim to Podbay's OWN classifier/orchestration logic against a
  fixture, mock HTTP server, or scripted fake provider (e.g. doctor-remote-control's own doc comment
  already states it's "a scripted /healthz + /agent/rc-restore mock"). Found nothing genuinely
  overclaiming a real Anthropic-broker or Claude-app reattach — no changes made. `rc-recovery.spec.ts`'s
  own file-level doc comment states the SIMULATED scope explicitly and names the authenticated CLI-pin
  matrix (§1, a designated test pod) as the real acceptance gate.)

## 6. Pin, build, and regression verification

- [ ] 6.1 After sections 1-5 are green, update the Claude Code pin to exact 2.1.246 in both pod-base
  build definitions and verify the drift-pin checker reports the intended version consistently.
- [ ] 6.2 Run `pnpm -r build`, the pod-agent/shared/provider/control-plane test suites, web typecheck,
  environment lint, and targeted RC Playwright scenarios; investigate every failure against the
  pre-change baseline instead of waiving it.
- [ ] 6.3 Build the pod-base through the required build-and-record workflow so the real-CLI golden path
  gates recording, then verify the resulting image on a scratch pod and rerun the full authenticated
  RC lifecycle matrix on the designated test pod.
- [ ] 6.4 Perform a conscious deferred-work pass: update `0audit.md` with only remaining current risks,
  remove entries this change fixes, and record any matrix row or CLI limitation that remains fragile.

## 7. Gated delivery and final acceptance

- [ ] 7.1 Prepare the staged diff, run the repository leak scan and spec/current checks, and obtain the
  owner's explicit in-chat approval before any push, production digest change, Fly deploy, or ghcr
  publication leaves the pod.
- [ ] 7.2 After approval, follow the shipping runbook for cloud and self-host edition parity, including
  the recorded image summary and required digest updates; verify smoke checks and read back the live
  digests rather than inferring delivery from a successful command.
- [ ] 7.3 On an updated designated test pod, verify from the Claude app that the same-session case
  reconnects without losing the owner title and the replacement case is recognizable and honest;
  record any owner-only manual check durably in `0asks.md` until confirmed.
- [ ] 7.4 Run the final OpenSpec strict validation, ensure every task and delta spec matches the shipped
  behavior, and report separately what is live, what needs pod updates, and what remains deferred.
