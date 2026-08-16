## Context

Self-host runs one Caddy front door (`:8080`) that already splits `/pods/*` (terminal WebSocket →
`serve:3001`) from everything else (→ `web:3000`), with pods joined to the `podbay-pods` Docker
network so Caddy can reach `podbay-<id>` by Docker DNS. Today `LocalProvider.createPod` publishes the
pod's dev server with `-p 3000` (a random host port) and `publishedAddress()` returns
`127.0.0.1:<hostport>` — the Docker host's loopback, unreachable from the owner's browser on another
machine. `install.sh` prints `hostname -I` (a private/NAT IP) with a generic "open the port" hint and
does no detection. The fix reuses the front door for previews and teaches install where it is.

## Goals / Non-Goals

**Goals:**
- Pod previews and the dashboard reachable from a remote browser, over HTTPS, in the common case.
- Work for owners **without a domain** (public IP only) — no "buy a domain or it won't work."
- One open port pair (80/443) regardless of pod count; no per-pod firewall rules.
- Honest install output: fix what we can, clearly state what we cannot verify.

**Non-Goals:**
- Multi-host / clustered self-host (single Docker host only).
- Custom per-pod domains chosen by the owner (pods get a derived subdomain).
- Automating cloud security-group / provider-firewall changes (invisible from inside; we only guide).
- Changing cloud edition behavior in any way.

## Decisions

- **Previews go through Caddy, not host ports.** Caddy matches the preview hostname and
  `reverse_proxy podbay-<id>:3000` over `podbay-pods`. `createPod` drops the `-p 3000` host publish
  in public modes (keep it in `local` mode, which still uses the loopback host port). This removes the
  random-port problem at the root and needs no per-pod firewall rule.

- **`publishedAddress()` is mode-driven.** A new `PODBAY_DEPLOY_MODE` (`local|ip|domain`) +
  `PODBAY_PUBLIC_BASE` (the base host: `<ip>.sslip.io`, or `pods.<domain>`) are threaded
  compose → `LocalProvider` → web. `publishedAddress(id)` returns:
  - `local` → `http://127.0.0.1:<hostport>` (unchanged),
  - `ip` → `https://<id>.<ip>.sslip.io`,
  - `domain` → `https://<id>.pods.<domain>`.
  The dashboard's own URL is derived the same way.

- **sslip.io for the no-domain default.** `<anything>.<ip>.sslip.io` resolves to `<ip>` with no
  config, so a bare public IP yields per-pod subdomains AND lets Caddy get real Let's Encrypt certs
  via HTTP-01 (the name resolves publicly). This is the standard self-host pattern (Coolify et al.).
  Raw `http://<ip>:<hostport>` stays available as an explicit opt-out for owners who won't take a
  third-party DNS dependency.

- **Caddy on-demand TLS + an `ask` guard.** Public modes use `tls { on_demand }` with
  `on_demand_tls { ask http://web:3000/api/selfhost/tls-check }`. The web endpoint returns 200 only
  for the dashboard host or a hostname whose `<id>` is a current pod — so an attacker spraying random
  hostnames can't drive unbounded cert issuance. Caddy caches certs on a mounted volume.

- **Caddyfile becomes mode-parameterized.** `start.sh` renders the site addresses from
  `PODBAY_DEPLOY_MODE`/`PODBAY_PUBLIC_BASE`: `local` keeps `:8080`; public modes serve the dashboard
  host + a wildcard preview host (`*.<base>`) on 80/443. The `/pods/*` terminal split is preserved
  inside the dashboard host block.

- **Install network step** (`install.sh`): detect public IP (cloud metadata endpoints →
  `podbay fetch`/`curl` to an IP echo, fallback `hostname -I`); if a public IP and no `--domain`,
  default to `ip` mode (offer `raw-ip` opt-out and `domain` if they have one); write mode + base into
  the env file; detect ufw/iptables/firewalld and offer to open 80/443; self-probe the front door;
  then print the real URL(s), the DNS records for `domain` mode, and the security-group caveat.

- **Honest reachability.** No self-probe result is reported as proof of EXTERNAL reachability
  (hairpin NAT makes it unreliable). The installer states plainly: OS firewall handled (or command
  shown); cloud security group is outside our reach — open 80/443 there if the URL doesn't load.

## Risks / Trade-offs

- **sslip.io is a third party.** Outage → preview DNS fails; pod URLs embed sslip.io. Mitigate:
  documented caveat, `raw-ip` opt-out, and `domain` mode as the durable upgrade. (nip.io considered;
  sslip.io preferred — it's on the Public Suffix List, so Let's Encrypt rate limits are per-IP.)
- **Let's Encrypt rate limits** (~50 certs/week per registered domain; per-IP for sslip.io). Fine for
  self-host scale; on-demand + the `ask` guard prevent runaway issuance.
- **Cloudflare-proxied domains** (orange cloud) break HTTP-01. Detect the Cloudflare nameservers/proxy
  and guide the owner to grey-cloud the records (or a future DNS-01 path); don't silently fail.
- **Port 80/443 conflicts** with an existing web server on the host. Detect a listener on 80/443 and
  refuse/deverride cleanly (fall back to `local` or a custom port) rather than crashing the proxy.
- **Dropping `-p 3000`** means anything that assumed a host port (older docs, direct curls) changes;
  scope the drop to public modes and keep local mode's loopback port for parity.
- **Owner still needs 80/443 open at the provider.** We can't do it for them; the honest-caveat design
  is the mitigation.
