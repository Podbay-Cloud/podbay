## Status: SHIPPED DORMANT (2026-07-12)

Mechanism built + verified on real Fly infra; enforcement is OFF by default (nextjs-starter
`policy: full`) pending a fix for the fresh-inbound blocker (§4). Flip an env to `trusted`/
`custom`/`none` to enable once §4 is solved.

## 1. Effective allowlist (shared)

- [x] 1.1 `@podbay/shared`: BASE_ALLOWLIST (agent API endpoints + registries) and
  TRUSTED_ALLOWLIST (curated dev set); `effectiveAllowlist(policy, allow)` →
  { enforce, domains }; unit tests per policy (`packages/shared/src/egress.ts`, committed a675257)
- [x] 1.2 Resolve: pod-spec carries the effective allowlist + enforce flag
  (`packages/shared/src/resolve.ts`, `packages/provider/src/fly/init.ts`)

## 2. Base image — transparent SNI proxy (pivoted from tinyproxy)

The tinyproxy/HTTP_PROXY design was abandoned: Fly's kernel has no iptables owner/cgroup match
(can't scope a proxy to the agent uid), and Node's `undici` ignores `HTTPS_PROXY` (so a CLI
would bypass an explicit proxy). Replaced with a custom Go **transparent** proxy that filters by
TLS SNI / HTTP Host, fed by iptables REDIRECT, with the proxy's own dials excluded via SO_MARK.

- [x] 2.1 `packages/provider/pod-base/egress-proxy/` — Go proxy: SO_ORIGINAL_DST recovery,
  dual-stack listen, SNI/Host parse, suffix allowlist, fwmark loop-exclusion
- [x] 2.2 Dockerfile: Go build stage + `iptables`; `podbay-egress` on PATH
- [x] Verified: allowed→200, denied→dropped (proxy logs DENY), non-80/443 blocked, transparent
  to Node undici (no proxy env needed), dev cannot flush rules without sudo

## 3. init.sh egress phase (every boot — iptables is ephemeral)

- [x] 3.1 Parse pod-spec `egress.enforce`/`domains`; write `/etc/podbay/egress-domains`
- [x] 3.2 Start proxy; nat REDIRECT 80/443→3129; filter REJECT-all except lo/DNS/established/
  6PN/redirected-hop/marked; drop `/etc/sudoers.d/dev` when enforcing
- [x] 3.3 **PATH bug fix** — pod-agent execs init.sh with an EMPTY PATH, so every
  `python3`/`iptables` step (permission preset, egress, kickoff) silently no-op'd at boot.
  Fixed: `export PATH` in init.sh + PATH in pod-agent `execFileSync` env. (Latent bug: permission
  presets had never actually seeded.)

## 4. BLOCKER — fresh inbound connections (why this ships dormant)

- [ ] 4.1 The REJECT-all rules (unavoidable without owner-match) break **fresh inbound `fly ssh`**
  into an enforced pod — reproduced. `--sport 22`, `fdaa::/16` filter-accept, and excluding 6PN
  from REDIRECT do NOT fix it; the proxy never sees the traffic, and Fly's kernel lacks the
  iptables `LOG` target so it can't be packet-traced from inside.
- [ ] 4.2 Web-terminal (gateway→pod-agent `:8080`) impact UNCONFIRMED — sibling-pod probe was
  blocked but that path ≠ the real gateway path. Must test the real gateway→pod path.
- [ ] 4.3 Likely fix: run the agent process in a dedicated network namespace (veth + proxy) so
  filtering is scoped to the agent, leaving pod-agent/hallpass in the unfiltered main netns.

## 5. Docs

- [x] 5.1 `docs/egress-plan.md` — approach, findings, dormant status, re-enable steps
- [x] 5.2 Env comment in `environments/nextjs-starter/podbay.yaml` (why `full` for now)
