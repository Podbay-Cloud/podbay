## 1. Deployment-mode config plumbing

- [x] 1.1 Define `PODBAY_DEPLOY_MODE` (`local|ip|domain`) + `PODBAY_PUBLIC_BASE` (base host, e.g.
      `<ip>.sslip.io` or `pods.<domain>`); read in `LocalProvider` (env + opts), default `local`.
- [ ] 1.2 Thread them compose (`selfhost/compose.yaml` env) → `LocalProvider` (done: reads env) →
      web (so the dashboard can render the true URL). [compose + web pending]
- [ ] 1.3 `start.sh`: persist the chosen mode/base into the env file so restarts keep it.

## 2. Preview routing through the front door (LocalProvider) — DONE

- [x] 2.1 `publishedAddress(id)` returns the mode-driven URL: `local` → loopback host port (unchanged);
      `ip`/`domain` → `https://<id>.<base>`.
- [x] 2.2 `createPod`: public modes DO NOT publish `-p 3000` (rely on Caddy → `podbay-<id>:3000`);
      `local` keeps the loopback publish. Pods still join the network in all modes.
- [x] 2.3 Unit-test `publishedAddress` for each mode (ip/domain/no-base); cloud/FlyProvider untouched.

## 3. Caddy: mode-parameterized hosts + automatic HTTPS — DONE (pending live verify)

- [x] 3.1 Proxy renders the Caddyfile from mode (inline `caddy-render` script): `local` keeps `:8080`;
      public modes serve the dashboard host + `*.<base>`, preserving the `/pods/*` terminal-WS split.
- [x] 3.2 Preview host block: `@pod host_regexp podid ^([a-z0-9…])[.]` → `reverse_proxy podbay-{re.podid.1}:3000`.
- [x] 3.3 On-demand TLS: `tls { on_demand }` + global `on_demand_tls { ask …/api/selfhost/tls-check }`;
      `caddy-data` volume mounted so certs persist.
- [x] 3.4 Ports mode-driven: `${PODBAY_PORT}:${PODBAY_PROXY_PORT:-8080}`; wizard writes a compose
      override mapping 80/443 for public modes (task 5).

## 4. On-demand-TLS authorization endpoint (web)

- [x] 4.1 Add `GET /api/selfhost/tls-check?domain=<host>` (OSS-only): 200 for the dashboard host or a
      host whose single leading label is a CURRENT pod id (DB lookup); 404 otherwise. Bounded to known
      hosts to prevent sslip.io cert-spray. `apps/web/app/api/selfhost/tls-check/route.ts`.
- [ ] 4.2 Test: known pod host → 200; unknown host → refused. [pending]

## 5. Install network wizard (`install.sh`) — DONE (pending live verify)

- [x] 5.1 Detect public IP: cloud metadata (169.254.169.254) → api.ipify.org; reject private/NAT ranges.
- [x] 5.2 Mode selection: public IP + no domain ⇒ `ip` (sslip.io); `PODBAY_DOMAIN` ⇒ `domain`; no public
      IP ⇒ `local`; `PODBAY_DEPLOY_MODE=raw-ip` opt-out. Overridable via env.
- [x] 5.3 Write mode/base/dashboard into `$DIR/.env` (compose auto-reads) + `compose.override.yaml`
      (proxy 80/443) for public modes; Caddy renders from that env.
- [x] 5.4 Firewall: detect ufw/firewalld; open 80/443 if root, else print the exact command.
- [x] 5.5 Port-conflict guard: check 80/443 (public) or `$PORT` (local) before `up`.
- [ ] 5.6 Cloudflare-proxy detection for `domain` mode (orange cloud breaks HTTP-01) → guide grey-cloud. [deferred — surfaces at live verify]
- [x] 5.7 HONEST reporting — no false "verified"; explicit cloud-security-group caveat + ports to open.
- [x] 5.8 Final output: the REAL dashboard/preview URLs per mode + DNS records (`domain` mode).

## 6. Docs + verification

- [x] 6.1 Updated `selfhost/README.md` (mode-aware URLs, sslip.io explainer) + `selfhost/docs/DEPLOYMENT.md`
      + the security guide; re-sync the public `podbay-cloud/install` mirror.
- [ ] 6.2 Update `openspec/specs/self-host/spec.md` with the applied requirements; `openspec archive`.
- [x] 6.3 VERIFIED LIVE on the dogfood VPS: `ip` mode (sslip.io) AND `proxy` mode (behind an existing
      Caddy) both served the dashboard + a real pod preview 200-over-HTTPS with Let's Encrypt certs.
      Bugs fixed en route: host_regexp→header_regexp, proxy joined podbay-pods. `domain` mode: same
      path, unverified (no test domain). Added coexistence `proxy` mode (not in the original scope).
- [ ] 6.4 Update `0audit.md` (remove the "previews are local-browser only" item once shipped).
