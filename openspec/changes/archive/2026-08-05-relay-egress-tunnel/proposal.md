## Why

The relay shipped as a per-fetch **content** service: the pod asks for a URL, the owner's browser
fetches it, and the **page body** comes back (`FetchOutput {status, body, …}`). That is the right shape
for an **agent reading a page**, and it uniquely reaches **login-walled** content (the owner's browser
carries the owner's cookies). But it is two things short.

1. **An app that fetches its own way can't use it.** A bespoke scraper (afisha-crawler) drives a live
   browser and runs LLM-generated `page.evaluate` extraction recipes against a real `Page`. The relay
   returns a reader-service markdown snapshot — there is no live DOM to run a recipe against. Rewriting
   every recipe to parse markdown is a massive, lossy change that still can't run the `page.evaluate`
   recipes at all, and routing a nightly bulk crawl through a verified per-page research command fights
   that command's purpose. The crawler already has the egress seam it needs — every fetch path reads
   `CRAWLER_PROXY_URL` (the old Tailscale exit-node hook), unset today, which is why it sits on the
   datacenter IP getting 403s.

2. **Nobody could find it.** Until 2026-08-04 the web-fetch skill told the agent the relay was "not
   built yet," so no pod used it — the feature was dark fleet-wide despite being fully built. The
   lesson: the relay's value is bounded by how effortlessly the **agent** reaches for it and the
   **owner** turns it on. Plumbing was never the hard part; the UX is.

So the relay needs (a) a second consumer — a **transparent egress tunnel** an app points at with one
env var, live-DOM intact — and (b) a UX where the **user faces one idea and one command, and the agent
drives everything else.**

## What Changes

**One relay, two consumers, one switch.** `pb relay start` (unchanged command) powers BOTH the existing
dispatch-fetch (agent reads; login-walled content) AND a new **SOCKS5 egress tunnel** (apps egress
through the owner's IP; live-DOM preserved). The owner never distinguishes them.

- **Tunnel mode (new).** The pod exposes a **local SOCKS5 endpoint** that forwards over the existing
  gateway tunnel to the owner's relay, which makes the outbound connection through the owner's network.
  `PODBAY_RELAY_PROXY` is **pre-set** to that endpoint and **fails closed** when no relay is running, so
  an app "uses the relay" with zero config; afisha's `CRAWLER_PROXY_URL` path lights up the moment the
  owner starts the relay.
- **The guards move to the proxy.** SSRF-refuse (no private/loopback targets), platform-derived domain
  audit, per-domain rate cap, bounded concurrency, fail-closed, owner-started + revocable — all enforced
  at the SOCKS layer, in the same domain-only privacy model as dispatch (host visible; path/content
  never).
- **Agent-driven, doc-free UX (a hard requirement, not polish).** The skill teaches the agent to:
  detect an IP-block, tell the owner the ONE command (surfaced in chat + cockpit, code pre-filled,
  `npx` = no install), rely on the pre-wired proxy (no manual env), verify egress with a health canary,
  and explain only what's needed — including the one extra command that ever exists, `pb relay login
  <site>`, and only when a specific site needs the owner's login. **Acceptance bar: a user succeeds
  having read zero docs.**
- **Cockpit + dashboards.** The relay indicator row gains a short human **(i)** (the ethos copy), a
  tunnel-live health signal, and tunnel metering (connections + bytes, per domain). Admin `/admin/relay`
  unifies fetch + tunnel per owner/pod/domain — domain-only, per-pod attribution live-only.

## Decisions (locked with the owner)

- **Tunnel ALONGSIDE dispatch, not instead of.** Different jobs: the tunnel gives the owner's **IP**
  (public content, live-DOM, apps); dispatch gives the owner's **session/cookies** (login-walled
  content, agent reads). Keep both.
- **SOCKS5 app-proxy, not WireGuard.** The proxy layer is where podbay's differentiator (domain audit,
  rate-cap, fail-closed, SSRF-refuse) lives natively; WireGuard is packet-level and needs an L7 proxy
  bolted on top anyway, plus TUN/`NET_ADMIN` the pod may lack and routing surgery on the owner's
  machine. SOCKS5 is selective by default — only proxied clients use it, so the agent's control-plane
  traffic stays off the owner's IP.
- **Pre-wired, fail-closed proxy** (`PODBAY_RELAY_PROXY`) — NOT global `HTTP(S)_PROXY` (that would route
  the agent's Anthropic/git/control-plane calls through the owner's home IP).
- **Ethos boundary:** the owner lends their **own** residential IP to their **own** pod for the sites
  they choose — SSRF-guarded, domain-audited, rate-capped, revocable, on only while they run it. Not an
  anonymous proxy; not evasion on a third party's behalf.

## The one user-facing idea

> Your pod can borrow your computer's connection for sites that block datacenters. Flip it on with one
> command on your laptop; the agent does the rest.

## Out of scope (named, not silently dropped)

- **Headed relay browser** for challenge-heavy sites (reddit) — a separate deferred item; the tunnel
  gives the IP, not a challenge-solver.
- **A signed one-line installer / desktop helper** to remove the Node-on-laptop assumption — a later
  friction-killer; `npx @podbay/pb` is the v1 assumption.
- **Per-owner egress quotas** off the new byte meter — the meter ships; enforcing a quota is a follow-up.
