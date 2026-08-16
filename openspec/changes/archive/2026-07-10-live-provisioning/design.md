## Context

All code exists and is unit-tested; the provider/gateway deliberately deferred the "live path"
(real Fly, base image, gateway deploy). This change does that wiring. It is integration + ops, not
new features — expect live debugging (6PN reachability, cookie domains, the image actually
booting). Decided: one change, all at once; assistant mints the Fly token via flyctl.

## Goals / Non-Goals

**Goals:** launch→terminal works in production for an approved user; pods sleep on idle; gateway
authenticated + owner-scoped.

**Non-Goals:** preview URLs; egress allowlist enforcement; multi-region; autoscaling; billing.

## Decisions

- **One Fly org, two apps.** `podbay-pods` holds pod machines; `podbay-gateway` is the WS proxy.
  Both in the same org as `podbay-web` → shared 6PN, so the gateway reaches pod-agent by private
  IPv6. The Fly token is org/app-scoped and lives only as a secret.
- **Pod base image = `packages/provider/pod-base` + bundled pod-agent.** Build `pod-agent` with the
  esbuild bundle, copy it in, `npm i node-pty ws` (linux), CMD `pod-agent` (which runs `podbay-init`
  then serves). Push to `registry.fly.io/podbay-pod-base`. node-pty compiles/prebuilds for linux in
  the image (unlike the earlier mac mismatch).
- **Gateway image is its own Dockerfile.** Workspace-aware build (like apps/web): install
  `@podbay/gateway...`, build the tree, run `dist/main.js`. Runtime env: `DATABASE_URL`,
  `BETTER_AUTH_*` (session validation via `@podbay/auth`), `FLY_API_TOKEN`/`PODBAY_PODS_APP`
  (provider endpoint resolution), `PODBAY_ENVIRONMENTS_ROOT` not needed (gateway doesn't launch).
- **Cross-subdomain cookie.** better-auth `advanced.crossSubDomainCookies` / cookie `domain`
  = `.podbay.cloud`, so the cookie set by `podbay.cloud` is sent to `gw.podbay.cloud`. Set
  `trustedOrigins` to include the gateway origin. This is the one real code change (in
  `@podbay/auth`).
- **Frontend → gateway.** `NEXT_PUBLIC_GATEWAY_URL=wss://gw.podbay.cloud`; the terminal connects to
  `wss://gw.podbay.cloud/pods/<slug>` with the cookie riding along.
- **Verify in stages even though it's one change.** (a) pod boots (fly logs), (b) gateway healthz,
  (c) authed WS reaches pod-agent, (d) full terminal + CLI login. Fix at whichever stage breaks.

## Risks / Trade-offs

- **The image not booting Claude correctly** (login flow, HOME/uid) → the smoke test + pod-agent
  audit already exercised this; verify with `fly logs` and a real launch, iterate.
- **6PN reachability gateway→pod** → both apps same org; test with the gateway's `endpoint` +
  a manual WS from the gateway. If Fly private DNS/IP resolution differs from assumptions, adjust
  `provider.endpoint`.
- **Cookie domain / CORS on the WS** → browsers send cookies on same-site WS upgrades; the
  `.podbay.cloud` domain + `trustedOrigins` should suffice; verify with a real connect, watch for
  401 at the gateway.
- **Cost / runaway pods** → sleep-on-idle via the gateway's idle sweep; only approved users can
  launch; start with tiny machines. Watch the Fly dashboard.
- **Secret sprawl** → the gateway app needs its own copy of DB/auth secrets; document, keep them
  in Fly secrets only.
- **Iterative** → unlike prior changes, this won't be one clean apply; budget for debugging. That's
  expected and fine.

## Migration Plan

Create apps + token + secrets; build/push the base image; deploy the gateway; set the frontend
gateway URL + cookie domain; deploy web. Rollback: unset `FLY_API_TOKEN` (provisioning off again),
stop the gateway app; the product returns to "navigable but launch disabled" — no data loss.

## Open Questions

- Gateway TLS/WS termination: Fly handles TLS at the edge; confirm WSS passes through to the app's
  ws server. Likely fine (Fly proxies WS), verify.
- Whether to pin one pod region matching the user or default `fra`. v0: `fra` (matches smoke).
