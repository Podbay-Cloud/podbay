# Changelog

All notable changes to `relay` (the Podbay relay CLI). This mirrors the package published to
npm as [`@podbay/relay`](https://www.npmjs.com/package/@podbay/relay).

## 0.2.2

- **`relay start --keep-awake`** — opt-in mode for a Mac meant to stay online 24/7: while the relay
  runs, it prevents the Mac from idle-sleeping (macOS `caffeinate -is`, auto-released when the relay
  exits — a crash never leaves your Mac stuck awake). Persisted, so it survives restarts;
  `--no-keep-awake` turns it back off. Off by default (a laptop should still be free to sleep). On
  Linux/Windows it's a no-op with a note — use your power settings there. Pairs with the 0.2.1
  heartbeat hardening: 0.2.1 stops the *self-inflicted* flaps, `--keep-awake` stops the Mac
  idle-sleeping the link out from under a dedicated relay host.

## 0.2.1

- **Heartbeat hardened against macOS throttling — stops the relay dropping its OWN connection.** The
  old liveness check terminated the gateway link after a single missed pong in a 5s window. On a Mac,
  App Nap / Wi-Fi power-save / timer coalescing routinely delay a background process's timers past
  that, so a perfectly healthy link got killed and reconnected on a loop (the "keeps disconnecting,
  dashboard still says connected" reports). Now: (1) a FROZEN process (a timer tick landing far
  overdue = the OS napped/slept us) resets and re-verifies instead of false-terminating on wake;
  (2) it takes TWO consecutive unanswered pings, not one, to declare the link dead; (3) a more
  tolerant 15s interval. A genuinely dead link is still caught (~30s) and reconnects; a jittery one
  is left alone.

## 0.2.0

- **Renamed: `@podbay/pb` → `@podbay/relay`, and the command `pb` → `relay`.** The tool is a relay,
  so it's now named one. Commands are top-level — `pb relay start` becomes **`relay start`**,
  `pb relay login <site>` becomes **`relay login <site>`**, etc. (a stray leading `relay` is still
  tolerated). Install with `npm i -g @podbay/relay`; `@podbay/pb` is deprecated and points here.
  The public source mirror moved to `github.com/podbay-cloud/relay`.

- **Faster relay drop detection.** The sleep/network-drop heartbeat now catches a dead gateway link
  in ~15s (a 10s ping with a 5s pong window) instead of up to ~40s, so egress recovers sooner after
  the host wakes — fewer failed connections at the start of a crawl.

## 0.1.13

- **The relay recovers on its own after the host sleeps or changes networks.** A slept laptop left
  the gateway connection half-open — no disconnect event fired, so the relay sat on a dead link
  still reporting "connected" while all egress silently failed, until you manually restarted it.
  A ping/pong heartbeat now detects the zombie link and closes it, so the existing auto-reconnect
  brings the relay back on its own (typically within a minute of waking).
- **`relay status` now reports the live gateway link**, not just whether the process is alive:
  a "link" line reads connected / reconnecting / unreachable from the running relay. (Also fixed the
  squished "dashboard" row.)
- **New `relay restart`** — stop then start, reusing your pairing. The manual escape hatch (though
  the heartbeat above should make it rarely necessary).

## 0.1.12

- **Pods show their name, not just the slug.** When the gateway sends a pod's owner-chosen display
  name, the dashboard shows it everywhere a pod appears — events, live, the pod filter, and Controls
  — falling back to the id when there's no name. (The id stays the stable key behind the scenes.)
  Requires an up-to-date gateway; older gateways still show the id, harmlessly.

## 0.1.11

- **Sites: filter by domain** — a search box on the Sites view. And each domain's "N events" and
  "N issues" counts are now links: click to jump to Events filtered to that domain — issues in
  amber, taking you straight to that site's problems.
- **Events: pod names show in full** — no more truncation or wrapping in the events table.
- **Cleaner header** — one relay-status indicator instead of three green dots. Dropped the
  redundant "Live" pill and the static "Private to this computer" label (privacy is explained in
  Controls); when the relay is stopped, the header now shows how fresh the saved history is.

## 0.1.10

- **Leaner Overview** — removed the "Page fetch / Live tunnel" explainer cards; the page leads
  straight with your numbers.
- **Sites is a proper domain aggregate** — it rolls up every domain for the range (not a handful)
  with its own All | Signed-in toggle, and is no longer tied to the events filter bar (which belongs
  to the Events view). "Signed-in" shows domains that had a signed-in fetch.
- **"Pod activity" shows all pods** — the Overview shortcut clears any pod selection first.
- **Clearer header** — the freshness pill reads "Live" while the relay is connected (and shows a
  real "Updated …" time only when it's stopped), and "Private to this computer" spells out that
  this detailed history never leaves your machine.
- **Fixes** — pod names no longer wrap in the events table or the pod filter dropdown; an expanded
  event row no longer collapses on the auto-refresh.

## 0.1.9

- **Live and Events are separate tabs now.** "Live" shows only what's using your connection
  right this second; "Events" is the full local audit with the filter bar. The Overview links to
  each with its own quick card — Live now, Recent events, and Recent pods.

## 0.1.8

- **Relay dashboard, reworked for clarity.** The local dashboard now separates page fetches
  from tunnel connections instead of merging them into one number, formats routed data
  correctly (rolling up to GB with grouping), and shows a real activity-over-time trend with
  an hourly axis and hover detail.
- **One consolidated, always-visible activity filter bar.** Mode, outcome, pod, and site
  filters sit together above the events table, each surfaced as a removable chip so it is
  always clear what is being filtered — including when a pod filter was applied from another
  view. Long history now loads incrementally instead of rendering every row at once.
- **Pods are a filter, not a separate tab.** Pod attribution moved into the Activity filter;
  per-pod pause/resume moved to Controls. All dropdowns are keyboard-accessible components.

## 0.1.7

- **Relay concurrency ceiling is now legible.** `relay check` reports live capacity
  (e.g. "N of 32 streams in use"), and refusals are classified — capacity, rate limit, or
  no-relay — so a client can size its concurrency to the cap and back off on the right signal
  instead of guessing.
- **Tunnel guard fails closed on an undeterminable peer.** If a connection's remote address
  cannot be resolved, it is refused rather than allowed through.

## 0.1.6

- **Owner command center.** The local relay dashboard: chronological activity, per-pod and
  per-site summaries, live in-flight fetches and tunnel connections, and owner controls
  (stop the relay, pause a pod, block a site, revoke signed-in use).
- Dashboard accounting fix.

## 0.1.5

- **Relay egress tunnel, end to end.** A pod can drive a real browser whose connection comes
  from *your* IP (gateway routing + owner-side dialing) — the answer to sites that block
  datacenter ranges at the edge. Exposed to pods as `$PODBAY_RELAY_PROXY`, and it fails closed.
- Tighter cookie-export guard.

## 0.1.4

- Relay watchdog and a login-hang fix; sign-in verification.

## 0.1.3

- Relay login quits the browser itself when you close the window.

## 0.1.2

- Durable reconnect token — the relay survives restarts and connection blips; coloured CLI output.

## 0.1.1

- Fixed help/disclosure text that referenced a removed command.
