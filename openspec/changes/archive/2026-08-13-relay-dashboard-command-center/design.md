## Context

The relay is unusually sensitive infrastructure: it lends every pod owned by one user the network identity of the computer running `pb`, and dispatch fetches may additionally use a browser session for sites the owner explicitly signed into. The current local dashboard is a second foreground HTTP process that reparses one unbounded JSONL file every two seconds and renders five unlabeled-looking counters plus a six-column host table. It cannot see the background daemon's websocket state, active work, or pod attribution. On a headless Linux machine it also crashes after `spawn xdg-open` emits an unhandled error.

The gateway already maps every request and tunnel stream to a gateway-authoritative `podId`; it drops that field when sending the owner relay its frame. The relay receives the full fetch URL and tunnel target already, but records only a host and combined tunnel bytes. Podbay intentionally does not persist per-pod relay history. That server-side privacy boundary remains correct; it does not require throwing the same data away on the computer performing the work.

The people using this surface need answers, not instrumentation: Is the relay on and connected? Which pod used my connection? Was it a clean fetch or signed in as me? Did it work? What is unusual or blocked? How much data moved? How do I stop or narrow it? They return after enabling the relay to verify it worked, while diagnosing a pod, when reviewing signed-in access, or when auditing unexpected traffic.

## Goals / Non-Goals

**Goals:**

- Make the local dashboard the canonical explanation, live status view, audit trail, and kill-switch surface for the owner relay.
- Preserve gateway-authoritative pod attribution on owner-bound protocol frames and persist it only on the owner's computer.
- Store enough local detail to explain an event without retaining content or credential-bearing URL material.
- Offer meaningful controls: stop all relay traffic, pause an individual pod, block a site, revoke signed-in use, export, clear, and set retention.
- Keep the published CLI standalone, dependency-light, backward compatible, loopback-only, and usable in GUI and headless environments.

**Non-Goals:**

- Hosted relay analytics or server-side detailed history.
- Response/request bodies, cookies, headers, browser storage, URL credentials, query strings, or fragments in the audit.
- A default-deny site/pod allowlist or per-request approval. Clean public-web relay remains on by default until the owner blocks a pod/site.
- Replaying failed work or controlling the pod itself from this page.
- A new frontend framework or build pipeline in the published `@podbay/relay` package.

## Decisions

### 1. Use a persistent safety header and desktop-first job tabs

The relay runs on a personal computer and the primary view is a desktop browser window. The product SHALL avoid one long dashboard document and instead use four top-level, URL-addressable tabs organized around owner jobs:

1. **Overview** — the plain-language Fetch/Tunnel contract, explicitly labeled selected-range metrics, attention summary, usage trend, live preview, and recent pod summary.
2. **Activity** — the full live view plus a chronological audit with filters and an Events/Sites secondary switch.
3. **Pods** — one card/row per observed pod with last seen, fetches, connections, data, issues, signed-in use, and Pause/Resume. Selecting a pod opens Activity already scoped to it.
4. **Controls** — signed-in sites, blocked sites, retention, export, clear history, and local storage location.

Relay state, local-only disclosure, last update, and the global Stop action remain visible in a persistent header above every tab. Tab labels carry useful counts—especially unresolved activity—so navigation cannot hide risk. The active tab lives in the URL fragment, supports browser history and refresh, and follows ARIA tab keyboard behavior.

The layout remains responsive for a narrow side-by-side desktop window and smaller screens, but desktop information density is the primary target. A chart is included only when there are enough time buckets to make “is usage changing?” answerable; it is not decorative. This structure is preferred over both a single long scroll and a denser admin-style table because the owner revisits the surface for distinct trust-and-control jobs rather than monitoring a fleet continuously.

### 2. Serve the command center from the daemon, with a read-only stopped mode

The running daemon will own the loopback HTTP server, runtime status, active-event registry, and local event store. It will bind `127.0.0.1` only, prefer port 7373, fall back to an available ephemeral port, and write its current local URL to a mode-0600 runtime file. `relay start` prints that URL. `relay dashboard` reads it and opens it; if the daemon is stopped, the command starts the same server in a foreground read-only-history mode until Ctrl-C.

This is preferred over polling daemon-written state files because live byte counts and connection lifecycles already exist in memory and actions would otherwise need a second IPC mechanism. It is preferred over keeping the current separate server because the current process cannot truthfully report connectivity or active work.

The browser opener remains best-effort. Child-process `error` is handled, and failure prints “Open this URL” while the server continues. Windows uses `cmd /c start` rather than attempting to spawn a `start` executable.

### 3. Add optional gateway-authoritative source metadata to owner-bound frames

Fetch frames gain `source: { podId }`; tunnel-open frames gain the same. Canary traffic gains `source: { system: "health-check" }`. The gateway creates this metadata from its routing context; it never accepts a pod-supplied attribution label. Queue draining preserves the stored `podId` when a fetch is eventually dispatched.

The fields are additive and optional. A new relay shows old-gateway events under “Unknown pod”; an old relay ignores the extra fields. The initial design uses the stable pod slug/id already available in the gateway instead of adding a control-plane lookup for a mutable display name. The UI can render a better name later if an optional name is added.

Passing the pod id to the relay does not create new server persistence: it is already live gateway state used for routing and is sent only to that pod owner's connected relay.

### 4. Use a versioned, bounded, day-partitioned local JSONL event store

The v2 event schema records:

- schema version, event id, started/finished timestamps, and duration;
- source pod id or system source;
- mode (`fetch` or `tunnel`) and lifecycle/outcome (`ok`, `site-refused`, `owner-blocked`, `safety-blocked`, `rate-limited`, `network-error`);
- safe target (`scheme + host + port + pathname` for fetches, `host + port` for tunnels), final safe target when redirected, HTTP status, reason, and whether the owner's signed-in session was used;
- bytes up and down separately for tunnels.

Sanitization occurs before persistence. URL usernames, passwords, query strings, and fragments are never written; content and headers never enter the event API. The pathname is retained because it is the difference between “reddit.com was touched” and an actionable local audit, while query strings are disproportionately likely to carry tokens and add little diagnostic value.

Events are appended to `events/YYYY-MM-DD.jsonl` with 0600 files under a 0700 directory. Default retention is 30 days with selectable 7/30/90-day options and a hard size ceiling; pruning runs at startup and once per day. The daemon builds an in-memory index for the retained window and updates it on append, so dashboard refreshes do not repeatedly scan the full history. Existing `fetch-audit.jsonl` remains readable as v1 “Unknown pod” events and can be retired after its rows age beyond retention.

JSONL is retained over SQLite to avoid a native dependency and installation failures in an `npx` CLI. Day partitioning plus the in-memory index provides bounded startup and query cost without a database migration surface.

### 5. Make local controls explicit denials, not a maintenance-heavy allowlist

The relay stays clean-and-open by default. The owner may add a pod id or domain to a local deny list. Incoming fetch and tunnel-open frames are checked before browser/socket work; a denial produces a normal protocol refusal and a local `owner-blocked` event. Pausing one pod does not affect siblings; blocking one site applies across the owner's pods because they share one residential identity and source budget.

“Stop relay” is the global immediate kill switch. “Revoke signed-in access” removes the domain from `loginDomains` immediately, so subsequent fetches use a clean context, and schedules deletion of that domain's cookies from the relay-owned profile. The UI distinguishes revoking signed-in use from blocking all clean access to the site.

Destructive actions require an inline confirmation that names the scope. Export produces the sanitized retained event set; clearing history does not reset pairing, blocks, or sessions. Replaying a failed request is omitted because the local relay does not own the original job intent and a generic retry could duplicate side effects.

### 6. Protect local mutation endpoints against browser-origin attacks

Loopback binding is necessary but not sufficient: a hostile webpage can attempt cross-origin writes to localhost. Each daemon start generates a high-entropy route token stored only in the mode-0600 runtime file and included in the local URL. State-changing requests additionally require a same-origin check, a per-process CSRF token embedded in the page, `POST`, and an exact JSON content type. Responses set a restrictive Content Security Policy, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and no permissive CORS headers.

Read-only stopped mode exposes no mutation routes. Static/dashboard routes reject unexpected Host values. The UI never renders event strings with `innerHTML`; dynamic data uses DOM text nodes to prevent a malicious hostname/path from becoming local script.

### 7. Keep the page package-native and accessible

The dashboard remains bundled HTML/CSS/vanilla TypeScript-generated JavaScript with no CDN assets or runtime network dependency. CSS grid owns alignment, numeric values use tabular figures inside their own cards/cells, columns collapse into labeled event cards on narrow screens, focus and status states are not color-only, and reduced-motion/high-contrast preferences are respected. Browser tests assert semantic names, keyboard operation, mobile overflow, and representative screenshots.

## Risks / Trade-offs

- [Pod ids make local logs more sensitive] → Store them only locally with restrictive permissions, bounded retention, clear/export controls, and disclosure; do not add them to platform persistence.
- [Paths can reveal private resource names] → Strip credentials, query, and fragment before the write boundary, explain local retention, and let the owner clear or shorten it.
- [A localhost action surface can be targeted by a webpage] → Use unguessable route + CSRF tokens, origin/host checks, POST-only JSON endpoints, restrictive headers, and tests that hostile origins fail.
- [Serving the dashboard from the daemon adds failure surface] → Dashboard startup is best-effort and must never prevent relay connectivity; bind fallback ports and isolate request-handler errors.
- [JSONL indexing consumes memory at high volume] → Bound retention and bytes, partition by day, store compact records, and paginate API responses; revisit an embedded database only if measured usage exceeds the bound.
- [Pausing a pod or site can make agent work fail unexpectedly] → Record the owner denial, return an actionable refusal reason to the pod, show active blocks prominently, and make Resume/Unblock one click.
- [Protocol skew] → Optional additive fields, Unknown pod fallback, mixed-version contract tests, and no change to result routing ids.
- [A separate read-only dashboard after stop could be mistaken for a running relay] → Lead with an unmistakable “Relay is stopped — showing saved history” state and disable/hide live controls.

## Migration Plan

1. Add v2 event parsing/writing, sanitization, retention, and v1 compatibility inside `packages/relay`; keep the old summary tests passing against converted events.
2. Add optional protocol source metadata in gateway fetch dispatch, queue draining, tunnel open, and canary frames; ship gateway first because old relays ignore it.
3. Add local deny policy checks and actionable protocol refusals in the relay.
4. Move dashboard hosting into the daemon, add the runtime file/token and crash-safe `dashboard` opener, then build the new UI and actions.
5. Update CLI/README/runbook disclosure and browser/unit/integration coverage; visually verify realistic multi-pod data at desktop and mobile widths.
6. Publish the relay only after the compatible gateway is deployed. Rollback is safe: the gateway fields are optional, old audit rows remain readable, and disabling daemon-hosted dashboard leaves relay transport unchanged.

## Open Questions

- Whether the default hard history ceiling should be 50 MiB or 100 MiB; measure a day of tunnel-heavy use before publishing.
- Whether a later protocol revision should include a mutable pod display name in addition to the stable slug. The first version intentionally avoids an extra control-plane lookup and stale-name history.
- Whether “keep until I clear it” should be offered after disk-usage telemetry is available locally; the initial 7/30/90-day choices keep storage behavior predictable.
