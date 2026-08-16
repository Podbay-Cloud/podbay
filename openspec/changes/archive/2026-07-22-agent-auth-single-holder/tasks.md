## 0. Confirm the linchpin (one clean test — vels does the 2 logins)

- [x] 0.1 **CONFIRMED 2026-07-14** on pods regional-lemur-3782 + subjective-booby-7d0b: two
  independent `/login`s → **different** refresh-token hashes (eb58…, ef23…), **both valid**, both
  `max`. Independent grants coexist; our capture never overwrote the other pod. (Sleep/wake
  persistence: live task 2.2.)

## 1. Grant ownership (control-plane + db)

- [x] 1.1 `holder_pod_id` column on `user_agent_credentials` (migration 0008); `holderPodId` on the
  store/vault (`holder`/`setHolder`); ownership is a soft ref — a dangling id (destroyed pod) is
  treated as free (`holderIsLive`)
- [x] 1.2 `credentialsForLaunch(ownerId, agents, newPodId)`: skip injection when a live holder owns
  the grant (→ pod boots to `/login`); claim it for this pod on inject. Transition guard: never
  reuse an UNtracked grant (holder null) while another pod runs (may duplicate its live login)
- [x] 1.3 `destroy`: write back the holder's fresh creds while still running, then teardown; the
  freed grant seeds the next pod
- [x] 1.4 `captureCredentials`: reject a non-holder's write-back (claim on bootstrap/free);
  `drainRunningHolders` refreshes only the holder
- [x] 1.5 Unit tests: bootstrap-claims-holder, concurrent-skip, reuse-after-destroy, sleeping-owner,
  non-owner-reject, transition-guard, per-user scoping (control-plane 82 green)

## 2. Verify (live — after deploy)

- [x] 2.1 gateway deploy applied migration 0008 (`holder_pod_id` verified live in prod); web deploy
  shipped the logic; smoke green. Running test pods untouched (idle-slept with their independent
  grants on-volume).
- [ ] 2.2 Live: pod A owns the grant; launch pod B concurrently → B requires /login, A never logs
  out; destroy A → next new pod reuses the freed grant (no login); persistence across sleep/wake
- [ ] 2.3 Confirm RC activates on any pod once it holds valid subscription OAuth
