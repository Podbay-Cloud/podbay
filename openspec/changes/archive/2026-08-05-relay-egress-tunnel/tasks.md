## 1. Pod-side local SOCKS5 proxy

- [x] 1.1 A userspace SOCKS5 server in the pod (bound to `127.0.0.1:<port>`), started with the pod-agent.
      Each accepted connection is multiplexed over the pod↔gateway control link to the owner's relay.
      — `relay-socks.ts` (codec) + `relay-proxy.ts` (server) + `relay-tunnel.ts` (TunnelMux). 25 tests.
- [x] 1.2 Fail-closed: with no relay connected, refuse the connection with a clean error (never hang,
      never leak to the datacenter path). A relay that drops mid-connection tears the connection down.
      — LIVE-VERIFIED: relay stopped → `curl (97) Can't complete SOCKS5 connection`.
- [x] 1.3 Export `PODBAY_RELAY_PROXY=socks5://127.0.0.1:<port>` into the pod environment at boot, and
      point the BYO/crawler convention var (`CRAWLER_PROXY_URL`, opt-in) at it by default — never global
      `HTTP(S)_PROXY`.
      — `init.sh` exports PODBAY_RELAY_PROXY. NOTE: pointing CRAWLER_PROXY_URL at it by default is NOT
        done — an app opts in explicitly. DECIDED 2026-08-04 (owner): keep it explicit. Defaulting
        CRAWLER_PROXY_URL would silently change egress for anything already reading that var.
- [x] 1.4 SSRF-refuse at the pod edge too (bare IP / loopback / private host rejected before dispatch).
      — shared `@podbay/shared/net-guard`.

## 2. Gateway tunnel routing
- [x] 2.1 Carry mux'd SOCKS streams pod↔owner over the control link, reusing the existing raw-tunnel
      primitive (the preview `<slug>` proxy). Assign request/stream ids at the platform, not trusted from
      the pod; deliver a stream only to the pod that opened it and only from that owner's relay.
      — `relay-tunnel-router.ts`, gateway-minted ids. 15 tests.
- [x] 2.2 Platform-side guard parity with dispatch: derive the domain from the CONNECT target, refuse
      non-public targets, count only connections the relay actually accepted against the rate budget.
      — SSRF + per-pod/per-owner concurrency + per-domain rate; refusals not charged.

## 3. Owner-side `pb relay` — tunnel mode
- [x] 3.1 On `pb relay start`, in addition to serving dispatch-fetch, accept tunnel streams and dial the
      target through the owner's network, streaming bytes both ways. No new command — one relay, both
      consumers.
      — `pb/src/relay-tunnel.ts`, wired in main.ts runDaemon. 8 tests.
- [x] 3.2 Owner-side SSRF-refuse (mirror the platform), per-domain rate/concurrency, full local audit
      (host:port, bytes ↑/↓, duration, allow/deny+reason).
      — incl. POST-DNS re-check (rebinding). Audit rows carry host/bytes/allowed.
- [x] 3.3 Tunnel is IP-only — a clean browser context, no owner cookies (sessions stay a dispatch/`pb
      relay login` property). Document that boundary in the CLI help.
      — documented in the skill + the cockpit ⓘ.

## 4. The pre-wired, agent-driven UX
- [x] 4.1 Skill: rewrite the relay section into the detect→offer→wire→verify→escalate playbook; the
      agent surfaces the exact `pb relay start` command (code from the pod pairing) in chat, relies on
      `PODBAY_RELAY_PROXY`, runs a health canary, and asks for `pb relay login <site>` only for
      login-walled sites. Acceptance: a user succeeds having read zero docs.
      — DONE — tunnel rung, browser+tunnel rule (from the live reddit test), owner-guidance playbook, description updated.
- [x] 4.2 Cockpit relay row surfaces the copy-paste `pb relay start` command + code, the ethos **(i)**
      (copy in design.md), and a **tunnel-live** health signal (canary through the proxy).
      — DONE 2026-08-04. ⓘ shipped + screenshot-verified; the row LINKS to /dashboard/settings where
        `RelayConnectCard` mints the command with a countdown + copy (it previously named
        `podbay relay start`, the POD's CLI, which the owner cannot run). Health: `TunnelRouter.canary()`
        opens ONE stream to podbay's OWN host (never a third party), fired once when a relay connects
        and on the owner's click; `relay-tunnel-health.tsx` shows working/not-working + usage headline.
        Never polled — a background heartbeat through someone's home connection is not ours to schedule.
        Real traffic can only CONFIRM health, never mark it failed (one dead target ≠ a broken tunnel).
- [x] 4.3 `@podbay/pb` README documents both consumers + the ethos; the cockpit **(i)** links to it. The
      README is reference, never required reading.
      — DONE — README leads with the fetch/tunnel table, why browser+tunnel beats a datacenter block,
        fail-closed, and that the dashboard distinguishes failed from ok. ⓘ links to the npm page.

## 5. Dashboards / metering

- [x] 5.1 Meter connections + bytes + per-domain conn/min at the platform (domain-only, byte-bucket, no
      path/content/who-asked persisted; per-pod attribution live-only).
      — `TunnelRouter.usageSnapshot()`, now exposed via gateway `/admin/relay-state`.
- [x] 5.2 `pb relay dashboard` (owner, local): live connections + today's totals + per-domain rollup +
      blocked attempts — full host/bytes detail (their own machine).
      — DONE — ok/failed accounting fixed (a 403 was counted as neither), tunnel connections + bytes split out. Shipped in @podbay/pb 0.1.6.
- [x] 5.3 Admin `/admin/relay`: unify fetch + tunnel per owner/pod/domain (conn counts, bytes, rate,
      denials, backpressure).
      — DONE 2026-08-04. Fleet stats + per-domain Tunnelled/Data, PLUS per-owner (open/total, data,
        tunnel health) and per-pod (open connections, data, domains) — the per-pod table now unions
        fetch and tunnel so a pod that ONLY tunnels is still visible. Per-owner/domain accumulate;
        per-pod is derived from open streams only, so it empties when traffic stops (the metering
        rule, deliberately). Optional fields, so an older gateway degrades to fetch-only.

## 6. Tests + verification

- [x] 6.1 Unit: SOCKS handshake + mux; fail-closed with no relay; SSRF-refuse (pod + platform + owner);
      rate/concurrency caps; the audit record is domain + byte-bucket only.
- [x] 6.2 Live e2e on a real pod (per the ops-access runbook — scratch pod / `incus exec`): owner runs
      `pb relay start`, a browser in the pod with `PODBAY_RELAY_PROXY` fetches an IP-blocked page and it
      succeeds via the owner's IP; stop the relay → fetch fails closed; a private-IP target is refused.
      — VERIFIED. Transport (egress via owner IP, browser-through-tunnel to reddit, fail-closed) proven
        on `moderate-peacock-59a7` across two sessions. Post-deploy 2026-08-05: on-connect HEALTH CANARY
        observed `ok` live in the gateway's `/admin/relay-state` (owner bF7MGi64…, probe:true); the
        owner confirmed the cockpit health row + admin metering surfaces work under real traffic (the
        populated per-owner/pod/domain tables — which read zero from a dev vantage with no traffic).
- [x] 6.3 Dogfood: afisha-crawler with `CRAWLER_PROXY_URL=$PODBAY_RELAY_PROXY` runs a real crawl end to
      end through the relay, recipes unchanged.
      — DROPPED as redundant (owner decision, 2026-08-05). The transport it would exercise is already
        live-proven end to end on `moderate-peacock-59a7` (egress via owner IP, browser-through-tunnel,
        fail-closed, health canary). A crawler pointing `CRAWLER_PROXY_URL` at `$PODBAY_RELAY_PROXY` is
        the documented opt-in path (docs/runbooks/relay.md) with nothing platform-side left to prove;
        can be run any time on a tunnel-image pod if a real afisha need arises.

## 7. Docs / specs

- [x] 7.1 Specs current in-commit: `web-fetch` (tunnel mode + agent-driven flow + guards) and `dashboard`
      (relay row (i) + tunnel health + metering). `openspec validate --strict`.
- [x] 7.2 Update `docs/runbooks/relay.md` and the web-fetch capability plan with the tunnel consumer.
      — DONE 2026-08-04. Runbook: fetch-vs-tunnel table, opt-in `CRAWLER_PROXY_URL`, the three SSRF
        layers, tunnel caps, "is it actually working?", and what stopping the relay does to each
        consumer. Capability plan: an update block explaining why BOTH consumers exist (the two-gate
        finding) and why that makes the BYO-WireGuard option unnecessary for the common case.

---

## RESUME HERE (state as of 2026-08-04, end of session)

**Shipped and live:** transport end-to-end (pod SOCKS → gateway router → owner's `pb`), image
`3c62aa3898c5` promoted, gateway + web deployed, `@podbay/pb@0.1.6` published, skill + cockpit ⓘ
merged to main. Live-verified on `moderate-peacock-59a7`: egress IP differs, Playwright-over-tunnel
rendered r/programming (solved the JS challenge), fail-closed confirmed under a real relay stop.

**20/20 — COMPLETE, DEPLOYED + VERIFIED (2026-08-05), ARCHIVED.** Gateway + web shipped to prod; the
on-connect health canary was observed `ok` live, and the owner confirmed the cockpit health row +
admin metering under real traffic on `moderate-peacock-59a7`. Task 6.3 (afisha dogfood) was dropped
as redundant by owner decision — the transport is already live-proven, so the crawler dogfood had
nothing platform-side left to prove.

**Known-good invariants to not break:** fail-closed (no relay → clean SOCKS refusal, never pod egress);
SSRF at three layers (pod literal / gateway platform / owner post-DNS); tunnel carries IP only, never
cookies; platform metering stays domain-only, per-pod attribution live-only.

**Traps:** scripted `incus` over SSH needs `</dev/null` (see docs/runbooks/agent-ops-access.md); the
pre-push hook blocks `packages/**/src` changes that touch no `openspec/specs/` (sync the delta, don't
just `[no-spec]` it); `pb` can carry NO workspace dependency (it publishes standalone — the net-guard
copy is kept honest by a source-diff parity test).
