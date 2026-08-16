## 1. Write-back helper + sleep hook (M1)

- [x] 1.1 `writeBackCredentials(ownerId, podId, agents)` — best-effort `captureCredentials` per
  agent; no-op without a vault; swallows failures
- [x] 1.2 Call it in `sleep(ownerId, id)` before `provider.sleep(id)` (pod still running)
- [x] 1.3 Call it in `sleepIdlePods` before each `provider.sleep(r.id)`
- [x] 1.4 Tests: sleeping a pod captures its current creds to the vault; a stale/empty blob is
  not stored (M3 still holds); no vault ⇒ inert

## 2. Drain-before-inject on launch (M2-lite)

- [x] 2.1 `drainRunningHolders(ownerId, agents)` — capture creds from the user's running pods for
  the launching env's agents
- [x] 2.2 Call it in `launchPod` before `credentialsForLaunch`
- [x] 2.3 Tests: launching drains a running holder so the injected creds are the freshest
  (holder rotated → new pod gets the rotated token, not the stale login)

## 3. Tests + verify

- [x] 3.1 Failure isolation: a capture error during sleep/launch doesn't break the operation
- [x] 3.2 `pnpm -r build` + control-plane suite green; leak-scan
- [x] 3.3 Verify on real pods: authed pod A → launch pod B → B is signed in (no "Login expired");
  sleep A, later launch B → still signed in
