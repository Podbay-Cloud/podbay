## 1. The flag

- [x] 1.1 Add a server-computed `harnessEnabled(harness)` (env `PODBAY_AGENT_HARNESS`, default includes
      `t3` so shipping the gate changes nothing) next to `editionOss()` in the shared session/edition layer.
- [x] 1.2 Thread it (like `oss`) into the two server pages: `dashboard/pods/[slug]/page.tsx` and
      `dashboard/pods/new/page.tsx`, and down to `pod-cockpit` / `launch-configure`.
- [x] 1.3 Unit-test the flag parse (default on; `t3` absent → off; case/space tolerant).

## 2. Hide T3 from the UI (4 choke points)

- [x] 2.1 `launch-configure.tsx`: hide the Control picker (474-521), pin `control="podbay"` when disabled.
- [x] 2.2 `pod-cockpit.tsx`: gate the `<T3ConnectPanel>` mount (1461).
- [x] 2.3 Gated the two URL-driven T3 wizard returns (t3connect, renew-then-t3) on t3Enabled; LEFT
      `renew-token` (generic). REFINED: T3Enabling is STATE-driven (not `?wiz=`-reachable) AND is the
      disable-progress screen, so it stays ungated — the server-action guards (§3) prevent it opening via
      a disabled enable.
- [x] 2.4 `pod-cockpit.tsx`: gate the `?enableT3=1` auto-enable effect (513) against a forged URL.
- [x] 2.5 Do NOT touch `pod-visual-state.ts` chips or `agent-cards.tsx` `externalControl` — they are
      driven by `t3_control` and go inert once enabling is blocked. Verify, don't gate.

## 3. Guard the server actions (6)

- [x] 3.1 `apps/web/lib/actions.ts`: early-refuse `enableT3Code`, `startT3Connect`, `submitT3ConnectCode`,
      `regenerateT3Pairing`, and the auto-enable branch in `completeSetupToken`. (createPod's `control`
      is moot — it is never forwarded to launchPod; T3 launch is the client `t3Suffix`, already gated in §2.1.)
- [x] 3.2 Leave `disableT3Code` reachable (an already-T3 pod must keep an off-switch).
- [x] 3.3 Test each guarded action refuses when off and behaves when on.

## 4. Pod-agent / DB / provider — untouched (verify inert)

- [x] 4.1 Confirm no pod-agent change: `CLAUDE_RC_OFF` yield + `healOrphanedRcYield` stay live (shared;
      the recovery for a previously-stranded pod). Add a note in the change that this is deliberate.
- [x] 4.2 Confirm no new `t3_control` writes occur with the flag off (the only writer is the gated enable).

## 5. Specs + verify (edition parity)

- [x] 5.1 The new `agent-harness-toggle` capability spec is the gating source of truth; confirm the
      existing dashboard/pod-agent/self-host T3 requirements still hold WHEN enabled (unchanged).
- [x] 5.2 Flag-off covered by a LIVE e2e (e2e/t3-disabled.spec.ts, PODBAY_AGENT_HARNESS=none: no Control
      picker, no cockpit T3 panel, launch still works, forged ?wiz=t3connect inert — 2 passed) PLUS source-level gating tests (t3-ui-gating.test.ts, 7) + the runtime flag
      (agent-harness.test.ts) + action guards (t3-harness-guard.test.ts) = 19 tests across 3 layers. A full
      RENDER e2e is harness-limited (no component-test lib; the e2e runs one server with a fixed env), so
      the live flag-off render is deferred to flip time (§5.3/§6.1) on the deployed app.
- [x] 5.3 Cloud verified: flag ON path = the existing t3-flows e2e (green); flag OFF = t3-disabled.spec
      (green) + the live prod flip. OSS already refuses T3 (t3BackendUrl null), so it's doubly-off there.

## 6. The flip

- [x] 6.1 DONE: PODBAY_AGENT_HARNESS=none set on podbay-web (live in the running process). T3 disabled in
      prod. Reverse with `fly secrets unset PODBAY_AGENT_HARNESS -a podbay-web`.
