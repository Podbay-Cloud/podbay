## Why

Decision (vels, 2026-07-15): **new pod = new login — one strict flow.** The credential-sharing
subsystem (vault capture/injection, write-back, freshness, single-holder) only optimized one narrow
case — destroy a pod, recreate within the token window, skip one login — while adding real
complexity and the rotation footguns we kept hitting (stale snapshots, holders, transition guards).
In practice the login flow is present most of the time anyway. Simple and robust wins:

> Each pod does its own `/login` once, owns its grant on its own volume, only ever rotates its own
> token → **never logged out**, no cross-pod interference, nothing to manage.

This SUPERSEDES `agent-auth-single-holder` (shipped 2026-07-15) and the M1/M2/M3 write-back
machinery (`agent-auth-writeback`) — all of it exists only to share a login, which we no longer do.

## What Changes

- **control-plane:** remove the credential vault wiring — `vault` config, `credentialsForLaunch`
  (launch injects nothing), `drainRunningHolders`, `writeBackCredentials`, `captureCredentials`,
  `forgetCredentials`, `listSavedAgents`, `credential-freshness`, `credential-vault` (delete files).
- **gateway:** remove capture-on-login-transition + vault wiring (status frames still forwarded —
  the wizard will consume the agent's authed signal).
- **web:** remove Saved-logins UI (user-menu section), `forgetCredentials` action, vault wiring.
- **provider:** remove `CreatePodInput.credentials` + the boot credential file injection
  (`/etc/podbay/credentials`, `credentialAgents` in the pod-spec); init.sh drops the move block.
- **pod-agent:** UNCHANGED — boot already runs `/login` when no credentials file exists, and the
  volume persists the login across sleep/wake. The in-pod login→kickoff respawn and the authed
  status reporting stay (the wizard's login-detection signal).
- **db:** drop `user_agent_credentials` (migration; also purges stored encrypted creds).
- **Keep:** `@podbay/shared/crypto` + `PODBAY_CRED_KEY` (still used by pod-secrets' SecretVault).

## Risks

- Existing pods are unaffected (their logins live on their volumes).
- The "relaunch without login" convenience is gone by design; the wizard makes the login step
  first-class instead of hidden.
