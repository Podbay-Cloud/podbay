# Design — relay egress tunnel

## Two consumers, one relay

`pb relay start` brings up ONE relay on the owner's machine that serves two pod-side consumers:

| Consumer | What it gives | For | Interface on the pod |
|---|---|---|---|
| **dispatch-fetch** (exists) | the owner's **session/cookies** — logged-in content | the *agent* reading a login-walled page | `podbay fetch get <url>` (returns verified content) |
| **egress tunnel** (new) | the owner's **residential IP** — public content, live-DOM | *apps/code* that fetch their own way (a crawler, a browser) | `PODBAY_RELAY_PROXY` (a local SOCKS5 endpoint) |

The owner turns on *the relay*; the pod picks the consumer. The agent uses dispatch for its own reads
and can point an app at the tunnel; a bespoke app just reads `PODBAY_RELAY_PROXY`.

## Why SOCKS5 app-proxy over WireGuard

The deciding factor is **where policy lives**, not throughput.

- **Policy/audit is native to a proxy.** SOCKS5 sees `host:port` per connection, so domain audit,
  per-site allowlist, rate-cap and SSRF-refuse enforce *at the proxy*, in the exact layer that matches
  the platform's domain-only privacy model. WireGuard is packets (L3): to get the same guards you run an
  L7 proxy/firewall on top of the tunnel — you build the proxy anyway, plus a VPN under it.
- **Unprivileged + userspace.** A SOCKS listener + WS forwarding needs no TUN device, no `NET_ADMIN`, no
  `/dev/net/tun` — it runs on an unprivileged pod and needs no routing/NAT surgery on the owner's
  laptop. WireGuard needs a TUN on both ends and the owner running an exit node with IP-forward + NAT.
- **Selective by default.** Only clients that set the proxy use it, so the agent's Anthropic/git/
  control-plane traffic stays on the datacenter IP. A route-based VPN tempts "all egress through home,"
  a privacy/foot-gun that needs policy routing to avoid.
- **Throughput doesn't decide it.** Research/nightly-crawl scale is fine over the WS; WireGuard's "direct
  P2P" edge is undercut by home NAT (you relay through the gateway/a DERP either way).

WireGuard would only win for a general high-throughput VPN — which is not the need.

## Data path

```
app/browser in pod ──SOCKS5──▶ pod-local relay proxy ──(gateway tunnel WS, mux'd)──▶ owner's `pb relay`
                                                                                          │
                                                                              outbound via owner's network
```

- The pod runs a small **local SOCKS5 server** (userspace) bound to `127.0.0.1:<port>`; `PODBAY_RELAY_PROXY
  = socks5://127.0.0.1:<port>` is exported into the pod env at boot.
- Each SOCKS connection is multiplexed over the pod↔gateway control link (reuse the existing tunnel
  primitive that serves the preview proxy) to the owner's relay, which dials the target and streams
  bytes back.
- **Fail-closed:** with no relay connected, the local proxy refuses connections (a clean error the app
  sees), so `PODBAY_RELAY_PROXY` is always safe to set and simply inert until a relay is up.

## Guards (carried from dispatch to the tunnel)

- **SSRF-refuse** at BOTH the platform (derive host from the CONNECT target) and the owner's relay: no
  bare IP, loopback, or private host — a prompt-injected pod must not reach the owner's LAN.
- **Domain audit** — platform records domain + outcome + a **byte bucket** + count; never the path, never
  content, never who-asked persisted; per-pod attribution live-only.
- **Rate/concurrency** — per-domain connections/min cap + a bounded concurrent-connection ceiling; a
  refused connection is not counted against budget.
- **Owner-started + revocable** — the tunnel serves nothing until the owner starts the relay; stopping
  it (or a relay reset) tears down live connections and fails closed.

Note the tunnel is **IP-only**: it does not carry the owner's cookies. "Fetch as me" stays a
dispatch-mode property (`pb relay login <site>`), which the tunnel deliberately does not replicate.

## The agent-driven flow (the hard requirement)

The skill encodes a playbook so the user reads no docs:

1. **Detect** — a fetch/crawl returns an IP-block signature (edge refusal / challenge with no content).
2. **Offer + guide** — tell the owner plainly: "this site blocks your pod's datacenter address; I can
   route through your own computer — run `npx @podbay/pb@latest relay start --code <code>` on your
   laptop." The code + full command are read from the pod's relay pairing and shown in chat AND the
   cockpit relay row.
3. **Wire** — nothing manual: the app already reads `PODBAY_RELAY_PROXY` (or the agent points the app's
   proxy setting at it). No env editing by the user.
4. **Verify** — a health canary through the proxy to a known echo confirms egress; the agent reports
   "you're through now."
5. **Escalate only when needed** — for a login-walled site, and only then, the agent asks for the one
   extra command `pb relay login <site>` and explains why (that site needs *your* sign-in).

## Copy — cockpit relay indicator (i)

Tooltip-sized, reframed around the one concept, with a link to depth:

> **Relay — lend your pod your own connection**
> Lets your pod reach sites that block datacenters by routing through *your* computer, for the sites you
> choose. On only while you run it · public web only (never your home network) · every site logged for
> you (domain only) · rate-limited per site. Not an anonymous proxy — your connection, your pod, your
> call. **[How it works →]**

Full `@podbay/pb` docs live in the GitHub README (the `[How it works →]` link). The user is never
*required* to read them — the flow lives in the agent (skill) and the cockpit.

## Dashboards / metering — what tunnel mode adds

The unit shifts from *fetches* to *connections + bytes*; three surfaces, one privacy boundary.

- **Owner's `pb relay dashboard`** (their machine — full detail, stays local): active mode(s); **live
  connections** (target `host:port`, bytes ↑/↓, duration); today's totals; per-domain rollup (conn +
  bytes); blocked attempts (SSRF/disallowed + reason); conn/min rate.
- **Cockpit relay row** (in-app, owner): status + **tunnel-live health canary**; recent activity
  (conn/min, bytes today, top domains); the ethos **(i)**.
- **Admin `/admin/relay`** (fleet, domain-only): fetch + tunnel unified per owner/pod/domain — conn
  counts, bytes, rate, denials, queue/backpressure; per-pod attribution live-only.

New meters: **bytes** (for abuse/cost visibility and a future quota), **concurrent connections**
(ceiling), **connections/min** per domain (the rate-cap unit). Owner-side log is full (host:port, bytes,
duration, allow/deny+reason); platform-side stays domain + outcome + byte-bucket + count.
