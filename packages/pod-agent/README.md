# @podbay/pod-agent

The in-pod terminal server. Runs inside a pod, attaches a real PTY to a persistent tmux session,
and streams it to the control plane over WebSocket. Replaces stock `ttyd` (whose auth/link/
clipboard limits the smoke test exposed).

## Run model

`pod-agent` is the pod's entrypoint (`main.ts`):

1. runs `/usr/local/bin/podbay-init` (first-boot seeding from `@podbay/provider` — idempotent).
2. reads the agent CLI from `/etc/podbay/pod-spec.json`.
3. starts `AgentServer` on the pod-internal address (`::8080` by default).

The tmux session boots the CLI: authenticated → `claude`; first run → `claude /login` (the login
URL is delivered to the client as a `links` chip, so it need not be clickable in the buffer).

## Wire protocol

Defined in [`@podbay/shared`](../shared) so the agent and the web frontend share one contract.
JSON text frames:

- client→agent: `input`, `resize`, `ping`
- agent→client: `output`, `links`, `status` (idleMs/idle/ready), `exit`, `pong`

## Sidecar signals

- **links**: `tmux capture-pane -pJ` (joined lines) recovers wrapped URLs whole → the frontend's
  link chips, no in-buffer link detection needed.
- **status**: idle duration + threshold, broadcast on a tick and to new clients, so the control
  plane can sleep the pod.
- **health**: `GET /healthz` reports readiness for the control plane / provider `endpoint`.

## Security boundary

The agent **has no end-user auth of its own** — it binds to the pod-internal interface and trusts
the connection from the authenticated control-plane front door. It never reads or transmits model
credentials.

## Session model (v0)

One PTY / tmux session mirrored to N concurrent clients. tmux resizes the shared window to the
smallest client (known behavior); grouped/independent per-client sizing is the later multiplayer
capability (see docs/reference/architecture-topology.md).

## Build & bundle

- `pnpm -F @podbay/pod-agent build` — tsc to `dist/` (library + `main.js` entry).
- `pnpm -F @podbay/pod-agent build:bundle` — esbuild standalone bundle to `dist-bundle/main.js`
  with `@podbay/shared` inlined and `node-pty`/`ws` external, for baking into the pod base image.

## Tests

`pnpm -F @podbay/pod-agent test` drives a **real PTY + tmux + WebSocket** (no terminal mocking).
Requires `tmux` on PATH. Uses vitest's `forks` pool — node-pty does not run in worker threads.

Note: node-pty ships prebuilt binaries; on an arch/runtime mismatch (e.g. an x64 Node on Apple
Silicon, or vice-versa) run `npx node-gyp rebuild` in its package dir to build from source.
