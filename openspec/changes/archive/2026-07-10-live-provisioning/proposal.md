## Why

Every layer is built and tested, and the product is navigable — but "Launch" says "not enabled"
and the terminal has no gateway to reach. This change flips the deferred live path **on**: real
Fly pods, the pod base image, and the deployed gateway, so a signed-in approved user can launch a
pod from `/new` and get a working terminal in the browser. This is the integration/deploy step —
mostly wiring, not new code — and the first time the whole chain runs against real infrastructure
end to end.

## What Changes

- **Fly pods app + token**: create the `podbay-pods` Fly app and a scoped Fly API token; set
  `FLY_API_TOKEN` (+ `PODBAY_PODS_APP`) on the control plane so `isProvisioningEnabled()` is true.
- **Pod base image**: build and push `podbay-pod-base` (Node + tmux + official Claude Code/Codex
  CLIs + the first-boot init + the bundled `pod-agent` as entrypoint) to a registry Fly pulls
  from; point the provider's `PODBAY_BASE_IMAGE` at it.
- **Gateway service**: deploy `packages/gateway` as its own Fly app (`podbay-gateway`) with the
  DB, auth, and Fly-provider config it needs; expose it at `gw.podbay.cloud`.
- **Cross-subdomain session**: configure the better-auth cookie for `.podbay.cloud` so the gateway
  (a different subdomain) can validate the browser's session.
- **Wire the frontend**: set `NEXT_PUBLIC_GATEWAY_URL=wss://gw.podbay.cloud` on podbay-web.
- **Verify end to end**: launch a pod → machine boots → open the terminal → sign into Claude
  inside the pod.

ToS-sensitive surface: the pod runs the unmodified official CLI on the user's own login inside the
pod; the control plane and gateway never handle model credentials.

## Capabilities

### New Capabilities
- `live-provisioning`: the real pod lifecycle in production — pods app + token, base image, gateway
  deployment, and cross-subdomain session — turning launch→terminal into a working flow.

### Modified Capabilities
- `auth`: the session cookie gains a `.podbay.cloud` domain so subdomains (the gateway) can read it
  (additive config; no schema change).

## Impact

- New Fly apps: `podbay-pods` (machines), `podbay-gateway` (WS proxy). New secrets: `FLY_API_TOKEN`,
  `PODBAY_PODS_APP`, `PODBAY_BASE_IMAGE`, gateway's DB/auth/provider env, `NEXT_PUBLIC_GATEWAY_URL`.
- `@podbay/auth`: cookie-domain config (`.podbay.cloud`).
- New Dockerfiles: gateway image; the pod-base image is built + pushed.
- Cost: running pod machines (sleep-on-idle keeps it low) + the gateway app.
- Non-goals (explicit): preview URLs (`*.preview.podbay.cloud`); egress allowlist enforcement
  (records policy only); multi-region pods; autoscaling; billing.
