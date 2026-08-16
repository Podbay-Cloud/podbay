## 1. Control-plane

- [x] 1.1 service.ts: remove vault config + credentialsForLaunch/drain/writeBack/capture/forget/
  listSavedAgents/holder helpers; launch injects nothing
- [x] 1.2 delete credential-vault.ts + credential-freshness.ts; prune index.ts exports
- [x] 1.3 delete/prune tests (credential-vault, agent-auth-writeback, agent-auth-single-holder,
  credential-freshness); suite green

## 2. Gateway + web

- [x] 2.1 gateway: remove vault wiring + capture-on-transition (keep status forwarding); tests green
- [x] 2.2 web: remove SavedLogins UI + forgetCredentials action + vault wiring; typecheck green

## 3. Provider + db

- [x] 3.1 provider: remove CreatePodInput.credentials, /etc/podbay/credentials injection,
  credentialAgents from pod-spec; init.sh drops the move block; tests green
- [x] 3.2 db: drop user_agent_credentials (migration 0009)

## 4. Ship + verify

- [x] 4.1 full suite (unit + e2e) green; leak-check
- [x] 4.2 deployed gateway (migration 0009 applied — user_agent_credentials VERIFIED dropped) → web (smoke green) → pod-base (sha256:9eebb5eb…)
- [ ] 4.3 live: new pod boots to /login; after login + sleep/wake it stays authed
- [ ] 4.4 archive superseded opsx changes (agent-auth-single-holder, agent-auth-writeback)
