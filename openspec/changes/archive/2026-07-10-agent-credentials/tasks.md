## 1. Vault

- [x] 1.1 `@podbay/shared`: AES-256-GCM encrypt/decrypt util keyed by `PODBAY_CRED_KEY`
  (random IV per blob, versioned format); unit tests incl. tamper rejection
- [x] 1.2 `@podbay/db`: `user_agent_credentials` table (userId, agent, blob, updatedAt) +
  migration applied to Neon; purge rows on user delete
- [x] 1.3 Mint `PODBAY_CRED_KEY`; set on podbay-web + podbay-gateway

## 2. Capture path

- [x] 2.1 `pod-agent`: health payload gains `authed` (credentials file exists) + short hash of
  the file, per agent from pod-spec
- [x] 2.2 Control plane: `captureCredentials(userId, podId, agent)` via provider exec (reads
  the agent's credentials file), encrypts, upserts vault; never logs contents
- [x] 2.3 Gateway: capture ONLY on the unauthenticated→authenticated transition (once per
  login), so Forget sticks and a pre-authed pod never re-captures

## 3. Injection path

- [x] 3.1 Provider `createPod`: accept optional per-agent credential blobs; write as first-boot
  files (0600) under `/etc/podbay/credentials/`
- [x] 3.2 `init.sh`: move blobs into `~/.claude/.credentials.json` / `~/.codex/auth.json`
  (owned dev, 0600) before first boot; never overwrite an existing live file
- [x] 3.3 Control plane `launchPod`: look up vault for the env's agents and pass blobs;
  boot command unchanged (it already branches on the credentials file)

## 4. User control + UI

- [x] 4.1 Dashboard "Saved logins" section: per-agent row + Forget action (server action
  deletes vault row)
- [x] 4.2 Flow check: forget → next pod requires login; login → capture → following pod
  pre-authed

## 5. Ship + verify

- [x] 5.1 Rebuild pod-base (`./scripts/deploy-pod-base.sh`); deploy web + gateway
- [x] 5.2 Live e2e: fresh pod → login once → second pod boots straight to authed prompt;
  forget → third pod asks for login
- [x] 5.3 Verify logs contain no credential material during capture/injection
