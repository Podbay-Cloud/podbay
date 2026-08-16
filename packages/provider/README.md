# @podbay/provider

Provider-agnostic pod lifecycle. A **pod** is one isolated compute instance + one persistent
volume, provisioned from a `ResolvedPod` (`@podbay/shared`). The `SandboxProvider` interface
hides infrastructure; `FlyProvider` implements it over the Fly Machines API.

## Interface

```ts
interface SandboxProvider {
  createPod(input): Promise<PodInfo>;   // idempotent by pod id
  getPod(id): Promise<PodInfo>;          // status "gone" if absent
  listPods(filter?): Promise<PodInfo[]>;
  exec(id, command): Promise<ExecResult>;
  sleep(id): Promise<PodInfo>;           // suspend (RAM snapshot); refused if keepAwake
  wake(id): Promise<PodInfo>;
  setKeepAwake(id, bool): Promise<PodInfo>; // pin awake during Remote Control
  snapshot(id): Promise<{ snapshotId }>;    // volume snapshot
  destroy(id): Promise<void>;               // removes machine AND volume
  endpoint(id): Promise<string>;            // agent address for a running pod
}
```

## Model

- **One Fly app holds all pod machines**; one volume per pod. Pod id ↔ machine via machine
  `metadata` (`podbay_pod_id`, `podbay_owner`, `podbay_volume_id`, `podbay_keep_awake`).
- **First-boot injection**: the provider injects `/etc/podbay/pod-spec.json` and the
  environment's `.claude/` layer as Fly machine `files`. The base image's
  [`pod-base/init.sh`](./pod-base/init.sh) seeds config + the permission preset and runs `setup`
  once, guarded by a marker so wake never re-seeds. **No credentials are ever injected** — the
  user authenticates the CLI inside the pod.
- **Base-image entrypoint**: the image runs [`@podbay/pod-agent`](../pod-agent), which calls
  `podbay-init` (the seeding above) and then serves the terminal (PTY↔WebSocket + sidecar).
  `init.sh` remains the documented first-boot contract that pod-agent invokes.
- **Sleep** = Fly `suspend` (falls back to stop). The provider owns the sleep decision (called
  by the control plane on an idle signal); `keepAwake` blocks it.

## Fly setup (for the live path)

```bash
fly apps create podbay-pods                 # the pods app
fly tokens create org                       # a scoped token for the control plane
export FLY_API_TOKEN=...   PODBAY_PODS_APP=podbay-pods
# build & push the base image:
cd pod-base && fly deploy --build-only --image-label latest ...  # or docker push to registry.fly.io/podbay-pod-base
```

Config via `loadFlyConfig()` reads `FLY_API_TOKEN`, `PODBAY_PODS_APP`, `PODBAY_REGION`,
`PODBAY_BASE_IMAGE`.

## Tests

`pnpm -F @podbay/provider test` runs unit tests against an in-memory Fly fake (no network).
The real path is exercised by a gated e2e:

```bash
PODBAY_LIVE_FLY=1 FLY_API_TOKEN=... PODBAY_PODS_APP=podbay-pods pnpm -F @podbay/provider test
```

## Known limitation (v0)

Fly has no per-machine egress allowlist like Anthropic's proxy. v0 records the environment's
network policy but does not fully enforce a custom allowlist; the allowlist proxy is a later
hardening change. Building pod images from a Dockerfile/devcontainer is also later — v0 boots a
prebuilt base image and injects config/setup at runtime.
