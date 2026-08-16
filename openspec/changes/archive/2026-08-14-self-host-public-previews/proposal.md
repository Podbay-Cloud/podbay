## Why

Self-host's whole point is "run it on my server and reach what I build" — but today a pod preview
resolves to `127.0.0.1:<random-docker-port>` (the Docker host's own loopback), so it is unreachable
from the owner's browser on any other machine, and the dashboard URL is only a best-effort private
IP (`hostname -I`) with a "open the port somehow" hint. On a VPS that means the dashboard is awkward
to reach and **previews simply don't work**, which defeats the reason to self-host at all. The
install never detects where it is running, never helps make anything reachable, and never tells the
owner a URL that actually works.

This must be solved generically for every self-host user — including those **without a domain**, who
must NOT be told "buy a domain or it won't work."

## What Changes

- **Pod previews route through the existing Caddy front door** (`reverse_proxy` to
  `podbay-<id>:3000` over the `podbay-pods` network, where Caddy already fronts `/pods/*` for the
  terminal) instead of per-pod host ports — one 80/443 pair, no per-pod firewall holes.
- **`publishedAddress()` returns the real public URL** for the pod's preview (an HTTPS subdomain),
  not `127.0.0.1:<port>`, driven by a new deployment-mode/public-base config threaded
  compose → `LocalProvider` → web.
- **Three auto-detected deployment modes**, chosen at install:
  - **local** — `localhost:8080`, no TLS (private/dev; current behavior, unchanged).
  - **ip** (public host, no domain — the default for a public VPS) — **sslip.io magic DNS**: the
    dashboard and every pod get subdomains (`<pod>.<ip>.sslip.io`) with **automatic Let's Encrypt
    HTTPS** via Caddy on-demand TLS. Zero DNS config; the owner just opens 80/443. Raw
    `public-ip:port` is offered as an explicit opt-out.
  - **domain** (owner's own domain) — dashboard + per-pod preview subdomains (`<pod>.pods.<domain>`)
    with Caddy on-demand HTTPS; the owner sets two DNS records.
- **Caddy on-demand TLS with an `ask` guard** so only valid dashboard/pod hostnames get certs.
- **An install-time network step** that detects the public IP (cloud metadata / sanctioned fetch,
  not just `hostname -I`), auto-picks and confirms the mode, writes the Caddy hosts + env, offers to
  open the OS firewall (ufw/iptables/firewalld for 80/443), self-probes, and — because cloud
  security groups are invisible from inside the box — **honestly flags what it cannot verify** rather
  than claiming a false "verified", then prints the REAL working URL and any DNS records to set.

## Capabilities

### New Capabilities
<!-- none — this extends the existing self-host capability -->

### Modified Capabilities
- `self-host`: adds requirements for remote reachability of the dashboard and pod previews
  (deployment modes, preview routing through the front door, on-demand TLS, and the install-time
  network detection/validation step with honest reachability reporting).

## Impact

- **Code:** `packages/provider/src/local/provider.ts` (`publishedAddress` + `createPod` pod
  networking / drop per-pod host publish in favor of front-door routing), `selfhost/compose.yaml`
  (Caddyfile: on-demand TLS, `ask` endpoint, preview-subdomain routing, 80/443), `selfhost/start.sh`
  (mode/public-base env), `selfhost/install.sh` (network-detection wizard), and a small web endpoint
  for the Caddy on-demand-TLS `ask` check.
- **Config/env:** new deployment-mode + public-base variables (e.g. `PODBAY_DEPLOY_MODE`,
  `PODBAY_PUBLIC_BASE`) threaded through compose → provider → web.
- **Dependencies:** relies on the public `sslip.io` wildcard-DNS service in `ip` mode (third-party;
  documented caveat + raw-ip opt-out). Let's Encrypt HTTP-01 via Caddy (already present).
- **Ports:** public modes serve on 80/443 instead of only 8080; 8080 stays for local mode.
- **Scope:** OSS/self-host only (`editionOss` + `LocalProvider` + `selfhost/`); cloud is untouched.
- **Docs:** `selfhost/README.md`, `selfhost/docs/DEPLOYMENT.md` + security guide updated; the public
  `podbay-cloud/install` mirror re-synced.
