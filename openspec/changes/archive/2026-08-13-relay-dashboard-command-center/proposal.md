## Why

`relay dashboard` is currently a host-level counter table: it does not explain whether the relay is running or healthy, which pod caused activity, what happened over time, or what the owner can do next. That makes a sensitive owner-operated capability feel like an unfinished debug page instead of a trustworthy control surface people will revisit.

The gateway already has authoritative pod attribution, while the owner's machine is already the intended home for detailed relay history. We can preserve Podbay's domain-only server-side privacy boundary and still give the owner a much richer, pod-aware local record.

## What Changes

- Reframe the local page as the relay's command center: lead with current relay state, what the relay does, its two modes (page fetch and tunnel), and whether traffic is flowing normally.
- Replace ambiguous inline counters and the flat domain table with a clear overview, pod-aware activity, issues requiring attention, site rollups, and a chronological event view.
- Extend gateway-to-relay frames with gateway-authoritative pod identity so fetch and tunnel activity can be attributed locally to the pod that caused it. The platform still does not persist that attribution.
- Store richer bounded history on the owner's computer: pod, mode, target detail, timing, status/outcome, session use, refusal reason, and directional byte counts. Cookies, response bodies, request bodies, and secrets remain excluded; query strings and fragments are redacted by default.
- Make the dashboard useful after the first visit with time-range and pod filters, recent-vs-prior context, live connections, signed-in-site management, per-pod pause/resume, per-site block/unblock, export, history clearing, and relay stop/start controls.
- Serve the command center from the running relay so it can show live state and actions; make `relay dashboard` open-or-print the durable local URL without crashing when no desktop opener exists.
- Add bounded retention, local-file permissions, schema migration/backward compatibility, and explicit disclosure of what is stored locally.
- Add responsive, accessible UI and browser coverage for empty, active, failed, multi-pod, and narrow-screen states.

## Capabilities

### New Capabilities

- `relay-owner-dashboard`: The owner-facing local relay command center, including information hierarchy, pod-aware local history, live state, actions, retention, and local security boundaries.

### Modified Capabilities

- `web-fetch`: Relay protocol events gain owner-local pod attribution and richer audit fields while Podbay's persisted telemetry remains domain-only and content-free.

## Non-goals

- Sending detailed URLs, paths, pod-attributed history, response content, cookies, or browser storage to Podbay.
- Turning the relay into an unrestricted VPN, exposing the local dashboard beyond loopback, or weakening the existing SSRF, rate, concurrency, or fail-closed guards.
- Per-request approval or a site allowlist for clean public-web access; oversight remains after the fact.
- A general analytics/observability product for pod workloads unrelated to relay traffic.
- Storing or displaying response bodies, request bodies, cookie values, authorization headers, or URL credentials. This remains a ToS- and account-sensitive surface because signed-in fetches automate the owner's session; the dashboard explains that risk but does not broaden the relay's authority.

## Impact

- `packages/relay`: local dashboard server/UI, daemon lifecycle, audit schema and retention, runtime state, local action endpoints, browser-open fallback, CLI copy, tests, and README.
- `packages/gateway`: additive fetch/tunnel frame metadata carrying gateway-authoritative pod identity; routing and privacy tests.
- `openspec/specs/web-fetch`: clarify that detailed, pod-attributed history is allowed only on the owner's computer while platform persistence remains coarse and domain-only.
- Protocol compatibility: new metadata is additive and optional so older relays and gateways continue to function; old audit JSONL rows remain readable.
- No hosted database migration and no new server-side collection of owner-local details.
