## 1. Shared logger

- [x] 1.1 `@podbay/shared/log`: `createLogger(svc)` → `info/warn/error(event, ctx)` emitting
  one JSON line to stdout; `err` serializer (message + code, no stack in prod); unit tests
- [x] 1.2 Redaction guard: drop keys matching `/token|secret|password|credential/i` from ctx

## 2. Gateway logging

- [x] 2.1 Log upgrade outcomes: accepted (user, pod), rejected (reason, status), upstream
  connect failure, abnormal close
- [x] 2.2 Log wake-on-connect attempts and timeouts

## 3. pod-agent logging

- [x] 3.1 Log listen, session create, client attach/detach (count), PTY exit code, init failure
- [x] 3.2 Rebuild pod-base via `./scripts/deploy-pod-base.sh` (digest re-pin included)

## 4. Provider logging

- [x] 4.1 Log Fly API retries (method, path, status, attempt) and terminal failures
- [x] 4.2 Verify no token material can reach a log line (test)

## 5. Web resilience

- [x] 5.1 `launchPod`/`wakePod`/`sleepPod` catch + log + return `{ error }` (destroyPod pattern);
  UI surfaces errors inline
- [x] 5.2 `app/error.tsx` + `app/pods/[slug]/error.tsx` branded error pages with retry + digest
- [x] 5.3 Deploy web + gateway

## 6. Verify

- [x] 6.1 Force each failure class (bad pod id, stopped machine, unauth WS) and confirm one
  clear log line each in `fly logs`
- [x] 6.2 Confirm no user flow can reach the default "Application error occurred" page
