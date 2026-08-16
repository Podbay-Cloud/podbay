## 1. Local event history foundation

- [x] 1.1 Add a versioned v2 relay event type and a safe-target normalizer that strips URL credentials, query strings, and fragments; unit-test fetch, redirect, tunnel, malformed, and credential-bearing targets.
- [x] 1.2 Replace the single unbounded audit reader with owner-only day-partitioned JSONL storage, a retained in-memory index, pagination/filter helpers, and 7/30/90-day pruning under a hard byte ceiling.
- [x] 1.3 Convert legacy `fetch-audit.jsonl` rows into read-compatible “Unknown pod” events and verify mixed v1/v2 history, malformed rows, retention expiry, clear, and sanitized export.
- [x] 1.4 Record distinct fetch outcomes, duration, safe initial/final target, HTTP status, signed-in use, and errors without recording body, headers, cookies, query, or fragment.
- [x] 1.5 Record tunnel outcome, duration, host/port, and bytes up/down separately, preserving completed and refused connections in the same event history.

## 2. Pod-attributed relay protocol

- [x] 2.1 Add optional gateway-authored `source.podId` metadata to immediate and queued fetch frames, with contract tests that the gateway ignores any pod-provided attribution and preserves routing ids.
- [x] 2.2 Add optional `source.podId` metadata to tunnel-open frames and an explicit system source to health canaries; cover real pod, canary, and mixed old/new protocol behavior.
- [x] 2.3 Carry optional source metadata through `RelayClient` and `RelayTunnel` into active snapshots and completed local events, falling back to “Unknown pod” for older gateways.
- [x] 2.4 Add a privacy regression test proving pod ids and safe paths are sent only on the owner-bound websocket and are not added to database writes, fetch memory, logs, or admin telemetry.

## 3. Live daemon state and reliable launch

- [x] 3.1 Introduce a relay runtime model for daemon state, gateway connectivity/reconnect state, active fetches, open tunnels, live directional bytes, version, and state-change timestamps, with deterministic unit tests.
- [x] 3.2 Start the loopback dashboard server best-effort inside the relay daemon, prefer port 7373 with ephemeral fallback, and write the actual tokenized URL to an owner-only runtime file without making dashboard failure stop relay transport.
- [x] 3.3 Change `relay dashboard` to open the daemon URL or serve retained history in foreground read-only mode when stopped; handle macOS, Windows, Linux, missing opener, headless, stale runtime file, and occupied-port cases without crashing.
- [x] 3.4 Update `relay start`, `status`, `stop`, and first-run copy so the local command center URL, connection state, and stopped/read-only behavior are unambiguous.

## 4. Owner-local controls

- [x] 4.1 Extend owner-only relay config with paused pod ids, blocked domains, and retention selection; add normalized add/remove helpers and migration defaults.
- [x] 4.2 Enforce paused-pod and blocked-domain denials before fetch browser or tunnel socket work, return actionable protocol refusals, record `owner-blocked`, and prove sibling pods/unblocked sites remain eligible.
- [x] 4.3 Add a daemon action to revoke a domain's signed-in use immediately and clear that domain's relay-profile cookies safely without changing clean access or unrelated sessions.
- [x] 4.4 Add authenticated local endpoints for stop, pause/resume pod, block/unblock site, revoke signed-in use, retention change, export, and clear history, with exact-scope confirmations in the client.
- [x] 4.5 Verify actions change only their named scope: clear leaves pairing/policy/sessions intact, revoke leaves clean access intact, and stop leaves saved history readable.

## 5. Local command-center UI

- [x] 5.1 Build the responsive page shell and status header with a plain-language Fetch/Tunnel contract, local-only storage statement, clear connected/reconnecting/stopped states, and the global Stop relay action.
- [x] 5.2 Build explicitly labeled time-range overview cards and an evidence-linked attention panel for site refusal, owner block, safety block, rate limit, network error, signed-in use, and healthy/empty states.
- [x] 5.3 Build “Pods using this relay” summaries with last seen, fetches, connections, data, issues, signed-in use, selection/filter behavior, and Pause/Resume actions.
- [x] 5.4 Build the live-now view and chronological activity view with safe expandable details and filters for time, pod, mode, outcome, and site; ensure live bytes/duration update without reloading history.
- [x] 5.5 Build the site rollup and settings surfaces for signed-in sites, site blocks, retention, disk location/size, export, and clear history.
- [x] 5.6 Render all event-provided text through DOM text APIs, add restrictive response headers, and avoid external fonts, scripts, CDNs, or network requests.
- [x] 5.7 Reorganize the desktop command center into URL-addressable Overview, Activity, Pods, and Controls tabs while keeping relay state, local-only disclosure, Stop, and attention badges persistent; include keyboard tab navigation and an Events/Sites activity switch.

## 6. Local server security and resilience

- [x] 6.1 Require a high-entropy per-process route, same-origin request, CSRF token, POST, and exact JSON content type for mutations; reject cross-origin, missing-token, wrong-host, and replayed/stale-token requests in HTTP tests.
- [x] 6.2 Bind every server mode to loopback only, set restrictive CSP/frame/content/referrer headers, emit no permissive CORS headers, and expose no mutation routes in stopped read-only mode.
- [x] 6.3 Exercise corrupt config/history, write failure, dashboard handler exception, port collision, gateway disconnect, and daemon shutdown so oversight failures never broaden access or crash relay transport.

## 7. Accessibility, browser verification, and documentation

- [x] 7.1 Add browser fixtures for empty, healthy single-pod, active multi-pod, failures/blocks, signed-in activity, legacy unknown-pod, stopped, and large-history states. (Active multi-pod preview fixture is complete; the remaining fixture states are pending.)
- [x] 7.2 Add Playwright flows for filters, expandable details, each local action and confirmation, keyboard navigation, visible/non-color-only state, and no horizontal page overflow at 375px.
- [x] 7.3 Capture and review desktop and mobile screenshots with realistic uneven values to verify that metrics belong visibly to their labels and activity remains scannable.
- [x] 7.4 Update the CLI README and relay runbook with command-center purpose, reasons to revisit it, local fields/retention, pod/site controls, URL redaction, ToS/session risk, data Podbay does and does not retain, and headless launch behavior.
- [x] 7.5 Run `@podbay/relay` unit/type/build tests, gateway relay/tunnel tests, package smoke install via `npx`, strict OpenSpec validation, and the repository's required package/source checks.
- [x] 7.6 Publish the sample-data UX through the pod's native owner-gated preview URL without exposing real relay data or mutation endpoints; verify the tabbed experience locally and the authenticated preview boundary over the public route.
