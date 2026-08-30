## 1. The flag

- [ ] 1.1 Add a server-computed `harnessEnabled(harness)` (env `PODBAY_AGENT_HARNESS`, default includes
      `t3` so shipping the gate changes nothing) next to `editionOss()` in the shared session/edition layer.
- [ ] 1.2 Thread it (like `oss`) into the two server pages: `dashboard/pods/[slug]/page.tsx` and
      `dashboard/pods/new/page.tsx`, and down to `pod-cockpit` / `launch-configure`.
- [ ] 1.3 Unit-test the flag parse (default on; `t3` absent → off; case/space tolerant).

## 2. Hide T3 from the UI (4 choke points)

- [ ] 2.1 `launch-configure.tsx`: hide the Control picker (474-521), pin `control="podbay"` when disabled.
- [ ] 2.2 `pod-cockpit.tsx`: gate the `<T3ConnectPanel>` mount (1461).
- [ ] 2.3 `pod-cockpit.tsx`: gate the three T3 wizard early-returns (959 T3Enabling, 1002 t3connect,
      1023 renew-then-t3) so a hand-typed `?wiz=` can't open them; LEAVE `renew-token` (generic).
- [ ] 2.4 `pod-cockpit.tsx`: gate the `?enableT3=1` auto-enable effect (513) against a forged URL.
- [ ] 2.5 Do NOT touch `pod-visual-state.ts` chips or `agent-cards.tsx` `externalControl` — they are
      driven by `t3_control` and go inert once enabling is blocked. Verify, don't gate.

## 3. Guard the server actions (6)

- [ ] 3.1 `apps/web/lib/actions.ts`: early-refuse `enableT3Code`, `startT3Connect`, `submitT3ConnectCode`,
      `regenerateT3Pairing`, the auto-enable branch in `completeSetupToken`, and reject `control:"t3"` in
      `createPod`, when the harness is disabled.
- [ ] 3.2 Leave `disableT3Code` reachable (an already-T3 pod must keep an off-switch).
- [ ] 3.3 Test each guarded action refuses when off and behaves when on.

## 4. Pod-agent / DB / provider — untouched (verify inert)

- [ ] 4.1 Confirm no pod-agent change: `CLAUDE_RC_OFF` yield + `healOrphanedRcYield` stay live (shared;
      the recovery for a previously-stranded pod). Add a note in the change that this is deliberate.
- [ ] 4.2 Confirm no new `t3_control` writes occur with the flag off (the only writer is the gated enable).

## 5. Specs + verify (edition parity)

- [ ] 5.1 The new `agent-harness-toggle` capability spec is the gating source of truth; confirm the
      existing dashboard/pod-agent/self-host T3 requirements still hold WHEN enabled (unchanged).
- [ ] 5.2 `apps/web/e2e/t3-flows.spec.ts`: add a flag-OFF variant (T3 absent from launch + cockpit; a
      `?wiz=t3connect` URL does not open) and keep the flag-ON path.
- [ ] 5.3 Verify BOTH editions: flag ON → T3 present & unchanged (cloud smoke); flag OFF → T3 gone from
      all flows, an already-T3 pod still turn-off-able; OSS still refuses T3 as today.

## 6. The flip

- [ ] 6.1 After the gate ships and verifies (default ON), set `PODBAY_AGENT_HARNESS` to exclude `t3` —
      the actual disable moment, reversible by re-adding it. Owner-gated (an env change on the apps).
