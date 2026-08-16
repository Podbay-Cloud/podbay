## Why

A fresh pod greets the user with a blank Claude prompt — indistinguishable from "a terminal
with Claude", which is exactly the commodity we must not be. The environment author knows what
the pod is for; the agent should speak first: greet, orient, propose concrete builds, and get
to work. This change is the experiment that lets us feel agent-led onboarding in nextjs-starter
before productizing plugin-binding and marketplace onboarding
(see docs/env-onboarding-plan.md for the full plan of record).

## What Changes

- **Env spec**: optional `kickoff` (string) — the prompt the agent CLI is started with. First-
  party, author-declared, and shown verbatim wherever the env is presented (disclosed-by-design;
  this is the anti-prompt-injection posture for future marketplace envs).
- **Login/kickoff separation** (the clean design): first boot runs the plain login flow; when
  the pod-agent observes the authenticated transition it **respawns the tmux window** with
  `claude "<kickoff>"` — the login process dies, a fresh agent-led session starts. Pods that
  are already authenticated boot straight into the kickoff. Envs without `kickoff` keep today's
  behavior exactly.
- **Plumbing**: kickoff resolves into the pod-spec; init.sh writes it to
  `/home/dev/.podbay-kickoff` (file, not shell interpolation — no escaping hazards); boot
  command uses it when credentials exist.
- **nextjs-starter** gets a real kickoff prompt (greet → inspect repo → propose three builds →
  offer to start the dev server).

## Capabilities

### New: `env-kickoff`

Environments can declare a kickoff prompt; pods start agent-led — after login on first boot,
immediately on later boots.

## Impact

- `@podbay/shared` (schema/resolve), `packages/provider` (pod-spec + init.sh),
  `packages/pod-agent` (boot command + authed-respawn watcher), `environments/nextjs-starter`.
- Pod-base image rebuild + digest re-pin. No web changes required.
- Sequencing: agent-credentials (next change) makes the kickoff path dominant (pre-authed pods
  skip login entirely).
