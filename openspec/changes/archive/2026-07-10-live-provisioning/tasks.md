## 1. Fly pods app + token

- [x] 1.1 Create the `podbay-pods` Fly app
- [x] 1.2 Mint a scoped Fly API token (flyctl); set `FLY_API_TOKEN` + `PODBAY_PODS_APP=podbay-pods`
  as secrets on podbay-web (control plane)

## 2. Pod base image

- [x] 2.1 `pnpm -F @podbay/pod-agent build:bundle` (standalone agent bundle)
- [x] 2.2 Build `packages/provider/pod-base` image with the bundle (Node + tmux + Claude Code +
  Codex + init + pod-agent CMD); node-pty + ws installed for linux
- [x] 2.3 Push to `registry.fly.io/podbay-pods:pod-base`; set `PODBAY_BASE_IMAGE` on podbay-web
- [x] 2.4 Verify: provider live e2e (`PODBAY_LIVE_FLY=1`) creates a real machine in `podbay-pods`
  that boots, execs, suspends, wakes, and destroys — all green

## 3. Cross-subdomain session (auth)

- [x] 3.1 `@podbay/auth`: cookie `domain=.podbay.cloud` (crossSubDomainCookies) + `trustedOrigins`
  incl. the gateway origin; web redeployed. `BETTER_AUTH_SECRET` rotated to a fresh value shared by
  both apps (the cookie-domain switch invalidates existing sessions regardless).
- [x] 3.2 Verify the session cookie is scoped to `.podbay.cloud` (config asserted; final browser
  check folded into 6.1 once gw DNS resolves)

## 4. Gateway deployment

- [x] 4.1 Gateway Dockerfile (workspace-aware build → `dist/main.js`) + `fly.toml` for `podbay-gateway`
- [x] 4.2 Create app; set secrets (DB, auth, `FLY_API_TOKEN`, `PODBAY_PODS_APP`, `PODBAY_BASE_IMAGE`,
  `COOKIE_DOMAIN`, `TRUSTED_ORIGINS`); `fly certs add gw.podbay.cloud`
- [x] 4.3 Deploy; both machines up and binding WS on `:::8090`
- [x] 4.4 6PN reachability provider → pod-agent exec confirmed by the live e2e; gateway → running
  pod folded into 6.1
- [ ] 4.5 **Operator step (Cloudflare):** add `A gw.podbay.cloud → 66.241.124.213` and
  `AAAA gw.podbay.cloud → 2a09:8280:1::146:b4ba:0`, then `fly certs check gw.podbay.cloud`

## 5. Wire the frontend

- [x] 5.1 Set `NEXT_PUBLIC_GATEWAY_URL=wss://gw.podbay.cloud` on podbay-web; redeployed (provisioning
  now enabled — `FLY_API_TOKEN` active on web)
- [ ] 5.2 Verify the terminal page connects (state → connected) — pending gw DNS + cert (task 4.5)

## 6. End-to-end verification (pending task 4.5 DNS)

- [ ] 6.1 Approved user: launch from `/new` → routed to `/pods/<slug>` → terminal connects
- [ ] 6.2 Run the agent CLI login inside the pod (link chip / paste-code); confirm a prompt works
- [ ] 6.3 Disconnect/reconnect resumes; idle → pod sleeps; reopen wakes

## 7. Docs

- [x] 7.1 Document the live topology + secrets in a deploy note (docs/deploy.md)
- [x] 7.2 Update docs/roadmap.md that live provisioning is on
