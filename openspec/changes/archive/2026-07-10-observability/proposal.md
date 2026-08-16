## Why

The first live pod session surfaced how blind we are when things go wrong: the pod-agent
crash-looped with the reason visible only via manual SSH; deleting a pod threw a raw
"Application error occurred" page; gateway rejections (401/404/502) are invisible after the fact.
Debugging took SSH archaeology instead of reading logs. Before adding more flows we make every
service tell us what happened, and make user-facing flows degrade gracefully instead of crashing.

## What Changes

- **Structured logging**: a tiny shared JSON-line logger (`@podbay/shared/log`) — `ts, level,
  svc, event`, plus context (`podId`, `userId`, `err`) — used by the gateway, pod-agent, provider,
  and web server actions. Fly captures stdout, so `fly logs` becomes greppable truth.
- **Gateway**: log every WebSocket upgrade outcome (accepted / rejected + reason + status),
  upstream pod-agent connect failures, and abnormal pipe closes.
- **pod-agent**: log lifecycle events — listen, tmux session create, client attach/detach,
  PTY exit, init failures.
- **Provider**: log Fly API retries and terminal failures (tokens/secrets never logged).
- **Web actions resilience**: all pod server actions (`launchPod`, `wakePod`, `sleepPod`,
  `destroyPod`) catch provider/store errors, log them, and return typed `{ error }` results the
  UI surfaces inline — never an unhandled throw to the framework error boundary.
- **Branded error page**: `app/error.tsx` + `app/pods/[slug]/error.tsx` so an unexpected crash
  shows a friendly retry page with the error digest instead of Next's default
  "Application error occurred".

## Capabilities

### New: `observability`

Structured, greppable logs from every service and graceful error surfaces in every user flow —
no silent failures, no raw framework error pages.

## Impact

- `packages/shared` (new `log.ts` export), `packages/gateway`, `packages/pod-agent`,
  `packages/provider`, `apps/web` (actions + error pages).
- Requires a pod-base image rebuild + digest re-pin (pod-agent logging) and web + gateway deploys.
- No schema/API changes; no new dependencies (hand-rolled ~40-line logger).
