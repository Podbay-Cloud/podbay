## 1. Spec plumbing

- [x] 1.1 `@podbay/shared`: `kickoff` in the env schema (optional string, sane max length);
  `ResolvedPod.kickoff: string | null`; tests
- [x] 1.2 `packages/provider`: pod-spec carries `kickoff`; `init.sh` writes
  `/home/dev/.podbay-kickoff` (0644, dev-owned) when present; test greps

## 2. Boot + respawn

- [x] 2.1 `pod-agent` boot command: with credentials + kickoff file → `claude "$(cat …)"`;
  without credentials → login flow unchanged; unit tests on the command strings
- [x] 2.2 `pod-agent` authed watcher: on tick, if booted unauthenticated and the agent's
  credentials file appears and a kickoff exists → `tmux respawn-window -k` into the kickoff
  command (as the session uid); once only; logged

## 3. nextjs-starter

- [x] 3.1 Write the kickoff prompt (greet → orient in repo → propose three concrete builds →
  offer to start `pnpm dev`)

## 4. Ship + verify

- [x] 4.1 Rebuild pod-base (`./scripts/deploy-pod-base.sh`)
- [x] 4.2 Live: fresh pod → login → window respawns into agent-led greeting; pre-authed pod
  boots straight into it; env without kickoff unchanged

## 5. Docs

- [x] 5.1 `docs/env-onboarding-plan.md` — the decisions and why (kickoff, login separation,
  plugin-binding direction, sequencing); linked from roadmap
