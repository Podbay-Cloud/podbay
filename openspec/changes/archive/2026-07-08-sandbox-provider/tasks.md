## 1. Package scaffold

- [x] 1.1 Create `packages/provider` (`@podbay/provider`, ESM, tsconfig, vitest); depend on `@podbay/shared`
- [x] 1.2 Wire into pnpm workspace; add a typed config loader (Fly token, pods app name, default region)

## 2. Interface & domain types

- [x] 2.1 Define `SandboxProvider` interface: `createPod`, `getPod`, `listPods`, `exec`, `sleep`,
  `wake`, `setKeepAwake`, `snapshot`, `destroy`, `endpoint`
- [x] 2.2 Define domain types: `PodInfo` (id, status, region, endpoint?, keepAwake), `PodStatus`
  enum (provisioning/running/sleeping/waking/gone/error), `CreatePodInput` (ResolvedPod + owner)
- [x] 2.3 Define typed provider errors (not-found, rate-limited, transient, conflict)

## 3. Fly client

- [x] 3.1 Thin Fly Machines REST client (create/get/list/exec/suspend/start/destroy machine;
  create/destroy/snapshot volume) with bounded retry + typed errors
- [x] 3.2 Pod-id ↔ machine mapping via machine `metadata`; region pinning at create

## 4. FlyProvider implementation

- [x] 4.1 `createPod`: idempotent (lookup by pod-id tag first); create volume + machine from
  ResolvedPod; pass non-secret env + first-boot init contract; NEVER write credentials
- [x] 4.2 `getPod` / `listPods` mapping machine state → `PodStatus`
- [x] 4.3 `sleep`/`wake` via suspend/start; `setKeepAwake` guards sleep; fallback stop/start
- [x] 4.4 `exec` via Fly machine exec → `{ exitCode, stdout, stderr }`
- [x] 4.5 `endpoint` resolves the pod's agent address for a running pod
- [x] 4.6 `snapshot` (volume snapshot) and `destroy` (remove machine AND volume)

## 5. First-boot injection contract

- [x] 5.1 Define the base-image init contract: on first boot, seed `.claude/` layer + resolved
  permission preset to the volume, run `setup` steps once, mark volume seeded
- [x] 5.2 Build a slim `podbay-pod-base` image (Node + tmux + Claude Code + Codex CLIs + init);
  document how a ResolvedPod maps onto machine config
- [x] 5.3 Assert wake does not re-run setup (seeded marker respected)

## 6. Tests

- [x] 6.1 Mocked Fly client: `createPod` fresh vs idempotent (no duplicate infra)
- [x] 6.2 Two pods → distinct volumes (isolation)
- [x] 6.3 sleep→wake preserves state; `keepAwake` refuses/defers sleep
- [x] 6.4 config/setup seeded once; no credential ever written (assert against injected env/files)
- [x] 6.5 destroy removes machine AND volume; getPod → gone
- [x] 6.6 Gated live e2e (`PODBAY_LIVE_FLY=1`): create → exec → sleep → wake → destroy on real Fly

## 7. Docs

- [x] 7.1 `packages/provider/README.md`: interface, Fly setup (pods app + token), known egress limitation
- [x] 7.2 Note in docs/roadmap.md that Phase-1 `sandbox-provider` is implemented
